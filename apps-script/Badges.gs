// ================================================================
// BC Dads WAG - Badges.gs
// Version: Nov 11, 2026 9:30 PM ET
//
// This file is the ONLY place badges are defined. Add, remove or change
// badges here without touching Code.gs. After editing: Save, then
// Deploy > Manage deployments > pencil > New version > Deploy.
//
// THREE KINDS OF BADGE
//   kind: 'title'      One holder (ties share it). Whoever has the HIGHEST
//                      score holds it. A score of 0 or less never wins.
//                      Add  lowest: true  to give it to the LOWEST score instead
//                      (still ignoring 0 or less).
//                        score:  function(s) { return a number; }
//                        detail: function(s) { return text shown on the badge; }
//   kind: 'weekly'     Works like a title, but it is about LAST WEEK only. It is handed
//                      out when a week closes (one feed post) and held until the next
//                      week closes. Use the s.lastWeek... numbers below.
//   kind: 'milestone'  Anyone who qualifies has it.
//                        earned: function(s) { return text if earned, or '' if not; }
//
// "s" IS ONE PERSON'S SEASON. You can use any of these:
//   s.name            last name
//   s.total           workouts that counted this season (max one per day)
//   s.complete        weeks made            s.missed   weeks bought the bet
//   s.played          complete + missed
//   s.streak          current run of weeks made
//   s.longest         longest run of weeks made
//   s.fines           total fines in dollars
//   s.bestWeek        most workouts in any one week
//   s.overWeek        first week number with 5+ workouts   (0 = never)
//   s.dailyWeek       first week with a workout all 7 days (0 = never)
//   s.earlyWeek       first week the minimum was hit by Wednesday (0 = never)
//   s.escapeWeek      first week he went dormie and still made it (0 = never)
//   s.comebackWeek    first week made right after buying the bet (0 = never)
//   s.balance         bank balance in dollars (negative = owes)
//   s.firesGot        fire reactions received       s.firesGave   given
//   s.inStrain        true if in the Strain challenge
//   s.strainSeason    season Strain total           s.strainBestWeek  best one-week total
//   s.strain100Week   first week with 100+ total strain (0 = never)
//   s.inWeight        true if in the Weight challenge
//   s.weightPct       percent weight change (negative = lost), or null
//   s.minutesSeason   workout minutes this season
//   s.compliantMinutes  workout minutes in the weeks he made (missed weeks left out)
//   s.lastWeek          number of the week that just finished (0 = none yet, or an off week)
//   s.lastWeekWorkouts  workouts that counted last week
//   s.lastWeekMinutes   workout minutes last week
//   s.lastWeekStrain    total day strain last week (Strain challenge members only)
//
// RULES OF THE ROAD
//   - Every badge needs its own unique id (letters, numbers, underscores).
//   - Keep the commas between badges.
//   - If one badge has a typo, only that badge disappears; the app keeps working.
// ================================================================

var BADGE_LIST = [

  // ---------------- TITLES (change hands) ----------------
  {
    id: 'workhorse', name: 'Workhorse', kind: 'title',
    desc: 'Most workouts this season.',
    score: function(s) { return s.total; },
    detail: function(s) { return s.total + ' workouts'; }
  },
  {
    id: 'strain_king', name: 'Strain King', kind: 'title',
    desc: 'Highest season Strain total (Strain challenge).',
    score: function(s) { return s.inStrain ? s.strainSeason : 0; },
    detail: function(s) { return s.strainSeason.toFixed(1) + ' total strain'; }
  },
  {
    id: 'biggest_loser', name: 'Biggest Loser', kind: 'title',
    desc: 'Biggest percent weight drop (Weight challenge).',
    score: function(s) { return s.weightPct !== null && s.weightPct < 0 ? -s.weightPct : 0; },
    detail: function(s) { return s.weightPct.toFixed(1) + '%'; }
  },
  {
    id: 'top_earner', name: 'Top Earner', kind: 'title',
    desc: 'Highest bank balance.',
    score: function(s) { return s.balance; },
    detail: function(s) { return money_(s.balance); }
  },
  {
    id: 'min_effort', name: 'Minimum Effort', kind: 'title', lowest: true,
    desc: 'Fewest workout minutes across the weeks he made (missed weeks are left out).',
    score: function(s) { return s.complete > 0 ? s.compliantMinutes : 0; },
    detail: function(s) { return Math.round(s.compliantMinutes) + ' min over ' + s.complete + (s.complete === 1 ? ' week' : ' weeks'); }
  },
  {
    id: 'pot_sponsor', name: 'Pot Sponsor', kind: 'title',
    desc: 'Most fines paid into the pots.',
    score: function(s) { return s.fines; },
    detail: function(s) { return money_(s.fines) + ' in fines'; }
  },

  // ---------------- WEEKLY (last week's best, held for one week) ----------------
  {
    id: 'wk_workouts', name: 'Workhorse of the Week', kind: 'weekly',
    desc: 'Most workouts last week.',
    score: function(s) { return s.lastWeekWorkouts; },
    detail: function(s) { return s.lastWeekWorkouts + (s.lastWeekWorkouts === 1 ? ' workout' : ' workouts') + ' in Week ' + s.lastWeek; }
  },
  {
    id: 'wk_strain', name: 'Strain of the Week', kind: 'weekly',
    desc: 'Highest total strain last week (Strain challenge).',
    score: function(s) { return s.inStrain ? s.lastWeekStrain : 0; },
    detail: function(s) { return s.lastWeekStrain.toFixed(1) + ' strain in Week ' + s.lastWeek; }
  },
  {
    id: 'wk_minutes', name: 'Iron Man of the Week', kind: 'weekly',
    desc: 'Most workout minutes last week.',
    score: function(s) { return s.lastWeekMinutes; },
    detail: function(s) { return Math.round(s.lastWeekMinutes) + ' min in Week ' + s.lastWeek; }
  },

  // ---------------- MILESTONES (anyone can earn) ----------------
  {
    id: 'perfect', name: 'Perfect Season', kind: 'milestone',
    desc: 'Compliant every week so far (at least 4 weeks).',
    earned: function(s) { return s.missed === 0 && s.complete >= 4 ? s.complete + ' for ' + s.complete : ''; }
  },
  {
    id: 'iron4', name: 'Iron Streak Bronze', kind: 'milestone',
    desc: '4 compliant weeks in a row.',
    earned: function(s) { return s.longest >= 4 ? 'Longest streak: ' + s.longest + ' weeks' : ''; }
  },
  {
    id: 'iron8', name: 'Iron Streak Silver', kind: 'milestone',
    desc: '8 compliant weeks in a row.',
    earned: function(s) { return s.longest >= 8 ? 'Longest streak: ' + s.longest + ' weeks' : ''; }
  },
  {
    id: 'iron12', name: 'Iron Streak Gold', kind: 'milestone',
    desc: '12 compliant weeks in a row.',
    earned: function(s) { return s.longest >= 12 ? 'Longest streak: ' + s.longest + ' weeks' : ''; }
  },
  {
    id: 'club50', name: 'Fifty Club', kind: 'milestone',
    desc: '50 workouts this season.',
    earned: function(s) { return s.total >= 50 ? s.total + ' workouts' : ''; }
  },
  {
    id: 'club100', name: 'Century Club', kind: 'milestone',
    desc: '100 workouts this season.',
    earned: function(s) { return s.total >= 100 ? s.total + ' workouts' : ''; }
  },
  {
    id: 'overachiever', name: 'Overachiever', kind: 'milestone',
    desc: '5 or more workouts in one week.',
    earned: function(s) { return s.overWeek ? 'First in Week ' + s.overWeek : ''; }
  },
  {
    id: 'daily_grind', name: 'Daily Grind', kind: 'milestone',
    desc: 'A workout every day of a week.',
    earned: function(s) { return s.dailyWeek ? 'First in Week ' + s.dailyWeek : ''; }
  },
  {
    id: 'early_bird', name: 'Early Bird', kind: 'milestone',
    desc: 'Hit the weekly minimum by Wednesday.',
    earned: function(s) { return s.earlyWeek ? 'First in Week ' + s.earlyWeek : ''; }
  },
  {
    id: 'dormie_escape', name: 'Dormie Escape', kind: 'milestone',
    desc: 'Went dormie and still made the week.',
    earned: function(s) { return s.escapeWeek ? 'First in Week ' + s.escapeWeek : ''; }
  },
  {
    id: 'comeback', name: 'Comeback', kind: 'milestone',
    desc: 'Compliant the week right after buying the bet.',
    earned: function(s) { return s.comebackWeek ? 'First in Week ' + s.comebackWeek : ''; }
  },
  {
    id: 'strain100', name: 'Strain 100', kind: 'milestone',
    desc: '100+ total day strain in one week (Strain challenge).',
    earned: function(s) { return s.strain100Week ? 'First in Week ' + s.strain100Week : ''; }
  }

];
