/**
 * Send templated emails to pilots in users.json.
 *
 * Template format (Markdown with YAML frontmatter):
 *
 *   ---
 *   subject: Your subject line here
 *   ---
 *   # Hello {{username}}
 *
 *   Your passphrase is **{{passphrase}}**.
 *
 * Available variables: any field from users.json, plus {{username}} (the key).
 *
 * Setup:
 *   1. Enable 2-Step Verification on your Google account:
 *      https://myaccount.google.com/security
 *   2. Generate an App Password:
 *      https://myaccount.google.com/apppasswords
 *   3. Create scripts/.env:
 *        GMAIL_USER=you@gmail.com
 *        GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
 *
 * Usage:
 *   node send_emails.js --template templates/registration.md
 *   node send_emails.js --template templates/registration.md --dry-run
 */

import nodemailer from 'nodemailer';
import { marked } from 'marked';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  });
}

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const DRY_RUN = process.argv.includes('--dry-run');

const templateArg = process.argv.indexOf('--template');
if (templateArg === -1 || !process.argv[templateArg + 1]) {
  console.error('Usage: node send_emails.js --template <path-to-template.md> [--dry-run]');
  process.exit(1);
}
const templatePath = path.resolve(__dirname, process.argv[templateArg + 1]);

if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  console.error('Missing GMAIL_USER or GMAIL_APP_PASSWORD in .env');
  process.exit(1);
}

// Parse frontmatter and body from a markdown file
function parseTemplate(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error('Template must start with YAML frontmatter (--- ... ---)');

  const frontmatter = Object.fromEntries(
    match[1].split('\n')
      .map(line => line.match(/^(\w+):\s*(.*)$/))
      .filter(Boolean)
      .map(([, k, v]) => [k, v])
  );
  if (!frontmatter.subject) throw new Error('Template frontmatter must include a "subject" field');

  return { frontmatter, body: match[2].trim() };
}

// Replace {{variable}} placeholders with values from a user record
function render(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`Unknown template variable: {{${key}}}`);
    return vars[key];
  });
}

const templateContent = fs.readFileSync(templatePath, 'utf8');
const { frontmatter, body } = parseTemplate(templateContent);

const users = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../users.json'), 'utf8')
);

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
});

async function main() {
  const entries = Object.entries(users).filter(([, u]) => u.email);
  console.log(`Template: ${templatePath}`);
  console.log(`Found ${entries.length} users with email addresses.`);
  if (DRY_RUN) console.log('DRY RUN — no emails will be sent.\n');

  for (const [username, user] of entries) {
    const vars = { username, ...user };
    let subject, renderedBody;

    try {
      subject = render(frontmatter.subject, vars);
      renderedBody = render(body, vars);
    } catch (err) {
      console.error(`✗ Template error for ${username}: ${err.message}`);
      continue;
    }

    const html = await marked(renderedBody);

    if (DRY_RUN) {
      console.log(`[dry-run] To: ${user.email} (${username})`);
      console.log(`          Subject: ${subject}`);
      console.log(`          ---`);
      console.log(renderedBody.split('\n').map(l => `          ${l}`).join('\n'));
      console.log();
    } else {
      try {
        await transporter.sendMail({
          from: `NorCal Hike & Fly <${GMAIL_USER}>`,
          to: user.email,
          subject,
          text: renderedBody,
          html,
        });
        console.log(`✓ Sent to ${user.email} (${username})`);
      } catch (err) {
        console.error(`✗ Failed for ${user.email}: ${err.message}`);
      }
    }
  }

  console.log('Done.');
}

main();
