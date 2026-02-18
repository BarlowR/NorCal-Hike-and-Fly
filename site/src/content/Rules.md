### Guiding Principles
* A 200km flight is roughly equivalent to running 100km on the ground.
* Triangles are cool.
* If there is time in the day and you're on the ground, the best direction to go is back towards your car.
* Hike and Fly is better with friends.

### Scoring

#### Divisions

Upon registration, a pilot will select a division. This should correspond to the highest wing class the pilot plans to fly throughout the season (EN-B/C/D). Divisions can be bumped up during the season (I.E. EN-B to EN-C) but not down. Send an email to [norcalhf@gmail.com](norcalhf@gmail.com) if you would like to jump up a division. 

#### Tracklog Submission for Scoring

All scoring is done using .igc tracklogs. These tracklogs must contain a single track for the whole day of scoring. Tracks must start after 8am, and must conclude by 5pm. If a track begins before 8am or ends after 5pm, it will be truncated to be within these bounds. 

Tracklogs must be submitted within 7 days. A method of submitting tracklogs on this site will be provided.

#### Hiking

All hiking must be performed with the same equipment set (wing, harness, reserve(s), etc.) that was used for the flying portion of the tracklog.


#### Triangles
All tracks are scored as either a flat triangle or a FAI triangle. There is no open distance scoring type. Any triangle that does not conform to the FAI specification is considered a flat triangle. Any triangle where no leg connecting vertices is shorter than 28% of the total distance is considered a FAI triangles. 

Triangles are calculated as 5 different points: The two closing points, and triangle vertices. The closing points are not necessarily the start and end of the tracklog, but instead are the two points on the tracklog where the triangle is closest to connecting.

Triangles are calculated from tracklogs using the triangle solver from the igc-xc-score library.

The score is initially established as 1 point per km of the total perimeter of the triangle calculated from the tracklog. 

#### Closing Distance, Triangle Closing, Triangle Closing Penalty 
The closing distance is calculated as the distance between the start point and the end point. Any triangle with a closing distance less than 5% of the total distance of the sum of the legs connecting vertices is considered "Closed".

A penalty of **2 points** per km of closing distance is assessed to the score.  
*Note that this penalty is significantly higher than normal XContest scoring*


#### Hiking Bonus
The total distance hiked is computed from the tracklog during portions when the pilot was on the ground. One point is added to the score for each km hiked. All distance hiked counts towards the score, not just hiking that contributes towards triangle turnpoints.


#### Triangle Multiplier
After:
* Triangle perimeter is calculated, closing penalty is assessed, and the hiking bonus is added, the resulting score is given a multiplier based on the triangle type and whether the triangle was considered closed. 

* Open flat triangle are given a 1.2 multiplier
* Closed flat triangle are given a 1.4 multiplier
* Open FAI triangle are given a 1.4 multiplier
* Closed FAI triangle are given a 1.6 multiplier

#### Hike and Fly with Friends Bonus
An additional multiplier of 1.5 is added if at least four tracklogs are submitted for a single day that start at the same place at the same time. I.E. go hike and fly with your friends. 


### Example 1: Long Hike Closed FAI  ([tracklog](/example_igc/ClosedFAI.igc))

<img
  src="/images/ClosedFAI.png"
  class="w-full object-cover rounded-xl shadow-lg"
/>

<p> 32.53km Hiking Distance </p>
<p> 29.30km Triangle Perimeter </p>
<p>  3.21km Closing Distance </p>

<p class = "font-bold"> Scoring:  </p>

<p> Triangle Perimeter: 29.30 </p>
<p> Closing Distance Penalty: -(2 * 3.21)   </p>
<p> Hiking Distance Bonus: +32.53    </p>
<p> Closed FAI Multiplier: x1.6 </p>
<p class = "font-bold"> Final Score: 88.65 </p>
Note: This track began before 8am, so it was truncated to begin at 8am

### Example 2: Flying Open FAI ([tracklog](/example_igc/OpenFAI.igc))

<img
  src="/images/OpenFAI.png"
  class="w-full object-cover rounded-xl shadow-lg"
/>
<p> 8.25km Hiking Distance </p>
<p> 29.96km Triangle Perimeter </p>
<p>  7.05km Closing Distance </p>

<p class = "font-bold"> Scoring:  </p>

<p> Triangle Perimeter: 29.96 </p>
<p> Closing Distance Penalty: -(2 * 7.05)   </p>
<p> Hiking Distance Bonus: +8.25    </p>
<p> Open FAI Multiplier: x1.4 </p>
<p class = "font-bold"> Final Score: 38.57 </p>

### Example 3: Open Distance ([tracklog](/example_igc/OpenTRI.igc))

<img
  src="/images/OpenTRI.png"
  class="w-full object-cover rounded-xl shadow-lg"
/>
<p> 15.50km Hiking Distance </p>
<p> 136.43km Triangle Perimeter </p>
<p>  64.31km Closing Distance </p>

<p class = "font-bold"> Scoring:  </p>

<p> Triangle Perimeter: 136.43 </p>
<p> Closing Distance Penalty: -(2 * 64.31)   </p>
<p> Hiking Distance Bonus: +15.50    </p>
<p> Open Flat Triangle Multiplier: x1.2 </p>
<p class = "font-bold"> Final Score: 32.64 </p>
