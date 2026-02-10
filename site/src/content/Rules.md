### Guiding Principles
* A 200km flight is roughly equivalent to running 100km on the ground
* Triangles are cool
* If there is time in the day and you're on the ground, the best direction to go is back towards your car.
* Hike and Fly is better with friends

### Scoring

#### Tracklog Submission for Scoring

All scoring is done using .igc tracklogs. These tracklogs must contain a single track for the whole day of scoring. Tracks must start after 9am, and must conclude by 5pm. If a track begins before 9am or ends after 5pm, it will be truncated to be within these bounds. 

A method of submitting tracklogs on this site will be provided.

#### Hiking
Distances of hiking segments are computed by summing the total distances between points taken at 20 second intervals. 

Hiking segments are awarded two points per km of total distance. 

#### Flying
Distances of flying segments are computed using the distance between discrete points of the tracklog: 
* End of hiking segments
* Start of hiking segments 
* Computed triangle turnpoints. 

#### Triangle
Triangles are calculated as 5 different points: The start point, the end point, and triangle vertices. The start point and end point are not necessarily the start and end of the tracklog, but instead are the two points on the tracklog where the triangle is closest to connecting.

Two types of triangles are possible, flat triangle and FAI triangle. Any triangle that does not conform to the FAI specification is considered a flat triangle. Any triangle where no leg connecting vertices is shorter than 28% of the total distance is considered a FAI triangles. 

#### Closing Distance & Triangle Closing
The closing distance is calculated as the distance between the start point and the end point. Any triangle with a closing distance less than 5% of the total distance of the sum of the legs connecting vertices is considered "Closed".

#### Triangle Closing Penalty 
The closing distance is calculated and a penalty of 1 point per km is assessed to the score. 

#### Triangle Multiplier
Different types of triangles are awarded a multiplier. 
* Open flat triangle are given a 1.2 multiplier
* Closed flat triangle are given a 1.4 multiplier
* Open FAI triangle are given a 1.4 multiplier
* Closed FAI triangle are given a 1.6 multiplier

#### Hike and Fly with Friends Bonus
An additional multiplier of 1.5 is used if at least four tracklogs are submitted for a single day that start at the same place at the same time. 