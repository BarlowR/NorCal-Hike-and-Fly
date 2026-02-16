#!/usr/bin/env python3
"""
test_upload.py — Smoke test for the tracklog upload Worker (IGC format)

Usage:
    python test_upload.py
    python test_upload.py --igc path/to/sample.igc
    python test_upload.py --rate-limit
    python test_upload.py --rate-limit --limit 10 --burst 15
"""

import argparse
import sys
import tempfile
from pathlib import Path

import requests

MINIMAL_IGC = """\
AXXX test
HFDTE150125
HFPLTPILOTINCHARGE:Test Pilot
B0800003747490N12241940WA0001000150
B0805003747500N12241800WA0001500200
B0810003747550N12241700WA0002000250
"""


def check(label: str, expected: int, response: requests.Response) -> bool:
    ok = response.status_code == expected
    mark = "✓" if ok else "✗"
    print(f"  {mark} {label} — {response.status_code}", end="")
    if not ok:
        print(f" (expected {expected})")
        print(f"    {response.text}")
    else:
        print()
    return ok


def run_upload_tests(url: str, igc_path: Path, user: str, passphrase: str) -> int:
    passed = 0
    failed = 0

    valid_qs = f"user_id={user}&passphrase={passphrase}"

    txt_path = Path(tempfile.mktemp(suffix=".txt"))
    txt_path.write_text("not an igc file")

    print(f"=== Upload Worker Tests ===")
    print(f"    {url}")
    print(f"    user={user}")
    print()

    # 1. Valid upload
    print("1. Valid IGC upload")
    with open(igc_path, "rb") as f:
        r = requests.post(f"{url}/upload?{valid_qs}", files={"file": (igc_path.name, f)})
    if check("should return 200", 200, r):
        passed += 1
    else:
        failed += 1

    # 2. Missing user_id
    print("2. Missing user_id")
    with open(igc_path, "rb") as f:
        r = requests.post(f"{url}/upload?passphrase={passphrase}", files={"file": (igc_path.name, f)})
    if check("should return 400", 400, r):
        passed += 1
    else:
        failed += 1

    # 3. Missing passphrase
    print("3. Missing passphrase")
    with open(igc_path, "rb") as f:
        r = requests.post(f"{url}/upload?user_id={user}", files={"file": (igc_path.name, f)})
    if check("should return 400", 400, r):
        passed += 1
    else:
        failed += 1

    # 4. Wrong passphrase
    print("4. Wrong passphrase")
    with open(igc_path, "rb") as f:
        r = requests.post(f"{url}/upload?user_id={user}&passphrase=wrong", files={"file": (igc_path.name, f)})
    if check("should return 401", 401, r):
        passed += 1
    else:
        failed += 1

    # 5. Non-existent user
    print("5. Non-existent user")
    with open(igc_path, "rb") as f:
        r = requests.post(f"{url}/upload?user_id=nobody&passphrase=wrong", files={"file": (igc_path.name, f)})
    if check("should return 401", 401, r):
        passed += 1
    else:
        failed += 1

    # 6. Wrong file type
    print("6. Non-IGC file")
    with open(txt_path, "rb") as f:
        r = requests.post(f"{url}/upload?{valid_qs}", files={"file": (txt_path.name, f)})
    if check("should return 400", 400, r):
        passed += 1
    else:
        failed += 1

    # 7. Wrong HTTP method
    print("7. GET instead of POST")
    r = requests.get(f"{url}/upload?{valid_qs}")
    if check("should return 405", 405, r):
        passed += 1
    else:
        failed += 1

    # 8. Wrong path
    print("8. Wrong endpoint")
    r = requests.post(f"{url}/notreal")
    if check("should return 404", 404, r):
        passed += 1
    else:
        failed += 1

    txt_path.unlink(missing_ok=True)

    print(f"\n=== Results: {passed} passed, {failed} failed ===")
    return failed


def run_rate_limit_test(url: str, igc_path: Path, limit: int, burst: int, user: str, passphrase: str) -> int:
    print(f"=== Rate Limit Test ===")
    print(f"    {url}")
    print(f"    sending {burst} requests (limit expected at ~{limit})")
    print()

    results = []
    for i in range(1, burst + 1):
        with open(igc_path, "rb") as f:
            r = requests.post(
                f"{url}/upload?user_id={user}&passphrase={passphrase}",
                files={"file": (igc_path.name, f)},
            )
        results.append(r.status_code)
        status = "✓" if r.status_code == 200 else f"→ {r.status_code}"
        print(f"  [{i:>3}] {status}")

        if r.status_code == 429:
            print(f"\n  Rate limited at request {i}")
            break

    num_ok = results.count(200)
    num_limited = results.count(429)

    print(f"\n=== Results ===")
    print(f"  200 OK:           {num_ok}")
    print(f"  429 Rate Limited: {num_limited}")
    print(f"  Other:            {len(results) - num_ok - num_limited}")

    if num_limited > 0:
        print(f"\n  ✓ Rate limiting is working (kicked in at request {results.index(429) + 1})")
        return 0
    else:
        print(f"\n  ✗ No 429 received — rate limiting may not be configured")
        return 1


def main():
    parser = argparse.ArgumentParser(description="Test the tracklog upload Worker")
    parser.add_argument("--worker_url", help="Worker base URL")
    parser.add_argument("--igc", help="Path to a sample .igc file (optional)")
    parser.add_argument("--user", default="test-user", help="Valid user_id for auth tests (default: test-user)")
    parser.add_argument("--passphrase", default="test-user", help="Valid passphrase for auth tests (default: test-user)")
    parser.add_argument("--rate-limit", action="store_true", help="Run rate limiting test instead of upload tests")
    parser.add_argument("--limit", type=int, default=10, help="Expected rate limit per window (default: 10)")
    parser.add_argument("--burst", type=int, default=15, help="Total requests to send (default: 15)")
    args = parser.parse_args()

    if args.worker_url:
        url = args.worker_url.rstrip("/")
    else:
        url = "https://tracklog-upload.norcalhf.workers.dev"

    # Resolve IGC file
    if args.igc:
        igc_path = Path(args.igc)
        if not igc_path.exists():
            print(f"Error: {igc_path} not found")
            sys.exit(1)
        cleanup_igc = False
    else:
        igc_path = Path(tempfile.mktemp(suffix=".igc"))
        igc_path.write_text(MINIMAL_IGC)
        cleanup_igc = True

    if args.rate_limit:
        failures = run_rate_limit_test(url, igc_path, args.limit, args.burst, args.user, args.passphrase)
    else:
        failures = run_upload_tests(url, igc_path, args.user, args.passphrase)

    if cleanup_igc:
        igc_path.unlink(missing_ok=True)

    sys.exit(failures)


if __name__ == "__main__":
    main()
