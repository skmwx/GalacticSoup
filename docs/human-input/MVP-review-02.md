# What this is

This is an MVP review done by a human (part 2).

# Space combat interface
A lot of useful information and controls are in the right hand panel, it's narrow and requires a lot of scrolling up and down during combat.

## Navigation panel
Let's move target selection to the same window where navigation is. There should be a switch between warp navigation and local navigation, or a tabbed view, and the window displays only the currently relevant information. 

### Warp view
Warp view displays only warp controls - possible desinations and "arrive at".

### Navigation view
Nav view dislays only local controls - "Approch", "Orbit", distance, and a list of possible targets. Active lock on the target should be displayed here. An icon indicating that target has lock on the player should be here.

## Righ-hand panel
Let's keep current target's characteristics in the right hand panel, but they should be re-arranged based on how important they are. From top to bottom:
1. Shild, Armor, Hull bars
2. Range
3. Speeds
4. What the target is running
5. The rest of the info - Type, attitude, role, bounty

Encounter panel in the bottom and it's collapsed by default.

## Left-hand panel
### Locks
Since we are now displaying the lock on the player in the nav view, remove it from here.

### Capacitor outlook
Under the capacitor bar, display the number of seconds estimated until it runs dry. The full phrase like "Runs dry in 87.9 s at this use" should appear as a tooltip if mouse hovers over it.

# Warping
Make warping distance-independent 2 seconds, in a single player game there is no point in making player wait.