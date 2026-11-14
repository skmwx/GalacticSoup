# What this is

This is an MVP review done by a human (part 2).

# Weapons interface
Right now the interface is overly verbose. Let's compact it and remove redundancy.

Keep the controls on top that affect all the weapons at once.

Below it, let's list weapons vertically (200mm Autocannon, 75mm Railgun). 

Each list entry shows magazine capacity without words, use icon for ammo, and total ammo in the hold in parenthesis. Should be something like "17/20 (180)", next to ammo is a reload button and a fire / cease fire switch.

Each list entry can expand, and when expanded, it displays:
1. Change ammo controls
2. Optimal / falloff / reac
3. Chances to hit and the main strain (without hint what to do with it).
4. Expected damage per shot.

In summary, we should have a compact list of weapons with regular controls immediately available, and detailed information and less often used controls collapsed.

# Modules interface
Similarly, let's make modules more compact.

Main entry Names, on-off switch, cycle time (ideally not with numbers, but with something like a round clock).

Descriptions and calculations are collapsed.