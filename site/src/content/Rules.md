### Guiding Principles
* A 200km flight is roughly equivalent to running 100km on the ground.
* Triangles are cool.
* If there is time in the day and you're on the ground, the best direction to go is back towards your car.
* Hike and Fly is better with friends.

### Scoring

#### Tracklog Submission for Scoring

All scoring is done using .igc tracklogs. These tracklogs must contain a single track for the whole day of scoring. Tracks must start after 8am, and must conclude by 5pm. If a track begins before 8am or ends after 5pm, it will be truncated to be within these bounds. 

A method of submitting tracklogs on this site will be provided.

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
The total distance hiked is computed from the tracklog during portions when the pilot was on the ground. One point is added to the score for each km hiked. 


#### Triangle Multiplier
After:
* Triangle perimeter is calculated, closing penalty is assessed, and the hiking bonus is added, the resulting score is given a multiplier based on the triangle type and whether the triangle was considered closed. 

* Open flat triangle are given a 1.2 multiplier
* Closed flat triangle are given a 1.4 multiplier
* Open FAI triangle are given a 1.4 multiplier
* Closed FAI triangle are given a 1.6 multiplier

#### Hike and Fly with Friends Bonus
An additional multiplier of 1.5 is added if at least four tracklogs are submitted for a single day that start at the same place at the same time. I.E. go hike and fly with your friends. 
