import { discordTimestampFromRaceTime } from '../shared/discordTimestamp.mjs';

export function scheduleRaceTimeDisplay(kaisaiDateYmd, race) {
  return (
    discordTimestampFromRaceTime({
      holdYmd: kaisaiDateYmd,
      raceId: race?.raceId,
      timeText: race?.timeText,
      style: 't',
    }) ||
    race?.timeText ||
    ''
  );
}
