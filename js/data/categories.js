// BIDLOCK — lot database.
// 8 categories x 8 lots = 64 lots. `trueValue` and `tier` are sealed until the verdict;
// `baseAppeal` ("hype") is public and deliberately imperfect: some lots are overhyped,
// some are sleepers. Synergy tags are public so a lineup can be planned around them.

export const TIERS = Object.freeze(['S', 'A', 'B', 'C', 'CURSED']);

export const SYNERGY_TAGS = Object.freeze({
  UK_LEGEND: 'UK Legend',
  SPEED_DEMON: 'Speed Demon',
  BILLIONAIRE: 'Billionaire',
  CHAOS: 'Chaos',
  STEALTH: 'Stealth',
  NOSTALGIA: 'Nostalgia',
  BUDGET_KING: 'Budget King',
  MUSCLE: 'Muscle',
  TECH_HEAD: 'Tech Head',
  FLEX: 'Flex',
});

export const SYNERGY_RULE = Object.freeze({ at: 3, bonus: 40, megaAt: 5, megaBonus: 80 });

function lot(category, n, name, tier, trueValue, baseAppeal, synergyTags, colorPalette, proceduralIconType, commentaryLine) {
  return Object.freeze({
    id: `${category}-${n}`,
    name,
    category,
    tier,
    trueValue,
    baseAppeal,
    synergyTags: Object.freeze(synergyTags),
    colorPalette: Object.freeze(colorPalette),
    proceduralIconType,
    commentaryLine,
  });
}

export const CATEGORIES = Object.freeze([
  {
    id: 'icons',
    name: 'YouTube Icons',
    short: 'ICONS',
    blurb: 'One creator fronts your whole lineup. Choose the face of the channel.',
    items: [
      lot('icons', 1, 'The Challenge King', 'S', 97, 98, ['BILLIONAIRE', 'CHAOS'], ['#f2b632', '#1d6fd1'], 'crown', 'He gave away an island before breakfast. Bidding starts at one dollar.'),
      lot('icons', 2, 'The Brofist Pioneer', 'S', 93, 90, ['NOSTALGIA', 'BILLIONAIRE'], ['#d9412b', '#f4f1e8'], 'play', 'A hundred million fists were bumped. Yours could be next.'),
      lot('icons', 3, 'The Group-Channel Captain', 'A', 84, 80, ['UK_LEGEND', 'FLEX'], ['#e8e3d4', '#b32020'], 'crown', 'Seven mates, one group chat, and he runs it.'),
      lot('icons', 4, 'The Chaos Wildcard', 'A', 78, 70, ['CHAOS', 'UK_LEGEND'], ['#39b36b', '#e6dc3c'], 'bolt', 'Nobody knows what he will do next. Including him.'),
      lot('icons', 5, 'The Tech Reviewer', 'B', 66, 62, ['TECH_HEAD', 'FLEX'], ['#c7352e', '#22262b'], 'phone', 'Crisp footage, matte black everything, and an honest seven out of ten.'),
      lot('icons', 6, 'The Mystery Uploader', 'B', 55, 45, ['STEALTH', 'CHAOS'], ['#5b6570', '#a9b4bf'], 'eye', 'No face, no schedule, forty million views. A sleeper if I ever saw one.'),
      lot('icons', 7, '2012 Block-Game Nostalgia', 'C', 38, 58, ['NOSTALGIA', 'BUDGET_KING'], ['#6aa84f', '#7a5230'], 'brick', 'It smells like a school holiday. Sadly, so does the view count.'),
      lot('icons', 8, 'Clickbait React Channel', 'CURSED', 9, 35, ['BUDGET_KING', 'CHAOS'], ['#e04a1a', '#f6e21d'], 'play', 'You will NOT believe what this lot does to a lineup. Number four will shock you.'),
    ],
  },
  {
    id: 'rides',
    name: 'Supercars & Rides',
    short: 'RIDES',
    blurb: 'What is parked outside says everything. Or nothing, if it is a unicycle.',
    items: [
      lot('rides', 1, 'Hypercar Prototype', 'S', 96, 95, ['SPEED_DEMON', 'BILLIONAIRE'], ['#c9261e', '#15171a'], 'car', 'One of one. Not road legal. Not anything legal.'),
      lot('rides', 2, 'Twin-Turbo JDM Legend', 'S', 90, 82, ['SPEED_DEMON', 'NOSTALGIA'], ['#2f6fd0', '#e8e8e8'], 'car', 'Two turbos, one poster on every bedroom wall since 1998.'),
      lot('rides', 3, 'Gold-Wrapped Boxy SUV', 'A', 76, 88, ['FLEX', 'BILLIONAIRE'], ['#d6a419', '#2a2a2a'], 'truck', 'It is loud, it is gold, and it has never once been off-road.'),
      lot('rides', 4, 'The $4 Bargain Coupe', 'A', 80, 40, ['BUDGET_KING', 'SPEED_DEMON'], ['#3a9a8c', '#d8d2c2'], 'car', 'Do not let the price tag fool you. Somebody always steals this one.'),
      lot('rides', 5, 'Armoured Angular Truck', 'B', 60, 72, ['MUSCLE', 'TECH_HEAD'], ['#9aa3ab', '#30363c'], 'truck', 'Bulletproof, allegedly. Panel gaps you could post a letter through.'),
      lot('rides', 6, 'Chopped Hatchback', 'C', 33, 30, ['UK_LEGEND', 'BUDGET_KING'], ['#b8bcc0', '#7d1f1f'], 'car', 'Lowered springs, loud exhaust, parked outside a chippy.'),
      lot('rides', 7, 'Shopping Trolley with NOS', 'C', 28, 44, ['CHAOS', 'SPEED_DEMON'], ['#a8b0b8', '#2e7bd6'], 'trolley', 'Nought to sixty is technically possible. Stopping is not.'),
      lot('rides', 8, 'Unicycle', 'CURSED', 7, 12, ['CHAOS', 'BUDGET_KING'], ['#8a8f94', '#c23b3b'], 'wheel', 'Half the wheels, none of the dignity.'),
    ],
  },
  {
    id: 'powers',
    name: 'Superpowers & Perks',
    short: 'POWERS',
    blurb: 'One power, permanent, no refunds. Read the small print.',
    items: [
      lot('powers', 1, 'Time Freeze (10s)', 'S', 95, 90, ['STEALTH', 'TECH_HEAD'], ['#56b6d8', '#eaf6fb'], 'clock', 'Ten seconds. Long enough to win any argument, or leave it.'),
      lot('powers', 2, 'Teleportation', 'S', 92, 94, ['SPEED_DEMON', 'STEALTH'], ['#7a5fd0', '#d9d2f5'], 'bolt', 'No more airports. No more "five minutes away".'),
      lot('powers', 3, 'Mind Reading', 'A', 82, 75, ['STEALTH', 'CHAOS'], ['#c75f9a', '#f1dbe8'], 'eye', 'You will know exactly what they think of you. Good luck with that.'),
      lot('powers', 4, 'Infinite Rizz', 'A', 74, 85, ['FLEX', 'UK_LEGEND'], ['#e0559b', '#f6c94a'], 'gem', 'Every text gets a reply. Every reply is a yes.'),
      lot('powers', 5, 'Summon Unlimited Chicken Wings', 'B', 58, 50, ['BUDGET_KING', 'CHAOS'], ['#c9762a', '#f0d9a8'], 'box', 'Unlimited. Sauce not included. Napkins not included.'),
      lot('powers', 6, 'Invisibility (Only When Nobody Looks)', 'C', 30, 55, ['STEALTH', 'CHAOS'], ['#9fb3bf', '#e6edf0'], 'eye', 'Works perfectly. Nobody has ever been able to confirm it.'),
      lot('powers', 7, 'Lag Switch IRL', 'C', 36, 30, ['TECH_HEAD', 'CHAOS'], ['#5c7a3a', '#c8d64a'], 'chip', 'Everyone around you freezes for a second. So do you.'),
      lot('powers', 8, 'Always Stubs Toe', 'CURSED', 4, 8, ['CHAOS'], ['#7a3b3b', '#d9a0a0'], 'shoe', 'It is a power in the sense that it is permanent.'),
    ],
  },
  {
    id: 'lairs',
    name: 'Dream Mansions & Lairs',
    short: 'LAIRS',
    blurb: 'Where the lineup sleeps. Square footage is a personality.',
    items: [
      lot('lairs', 1, 'Private Island Compound', 'S', 97, 96, ['BILLIONAIRE', 'STEALTH'], ['#2f9e8f', '#e9d9a6'], 'house', 'Its own runway, its own reef, its own postcode.'),
      lot('lairs', 2, 'Glass Cliffside Penthouse', 'S', 89, 86, ['FLEX', 'BILLIONAIRE'], ['#8fc4d6', '#2b3238'], 'tower', 'Floor-to-ceiling glass. Do not own a football.'),
      lot('lairs', 3, 'Underground Night-Bunker', 'A', 83, 70, ['STEALTH', 'TECH_HEAD'], ['#3b424a', '#d6a419'], 'shield', 'Forty metres down, a waterfall door, and no visitors ever.'),
      lot('lairs', 4, 'The Creator House Classic', 'A', 77, 78, ['UK_LEGEND', 'NOSTALGIA'], ['#b9502e', '#eadfc8'], 'house', 'Six bedrooms, eleven cameras, one very tired neighbour.'),
      lot('lairs', 5, 'Converted Haunted Castle', 'B', 63, 60, ['UK_LEGEND', 'CHAOS'], ['#6a6f7a', '#a58fd0'], 'tower', 'Draughty, listed, and the previous owner has not technically left.'),
      lot('lairs', 6, 'Luxury Treehouse', 'B', 52, 48, ['STEALTH', 'BUDGET_KING'], ['#4f8a3c', '#8a5a30'], 'house', 'Underfloor heating, rope ladder, squirrels on the lease.'),
      lot('lairs', 7, 'Inflatable Pool Tent', 'C', 24, 22, ['BUDGET_KING', 'CHAOS'], ['#3fa7d6', '#f08a3c'], 'box', 'Sleeps four until somebody opens a window.'),
      lot('lairs', 8, 'Cardboard Box', 'CURSED', 6, 10, ['BUDGET_KING', 'STEALTH'], ['#a67c4a', '#d9b98a'], 'box', 'Open plan. Excellent recycling credentials.'),
    ],
  },
  {
    id: 'squad',
    name: 'VIP Bodyguards & Squad',
    short: 'SQUAD',
    blurb: 'Somebody has to stand behind you looking serious.',
    items: [
      lot('squad', 1, 'Prime Heavyweight Champ', 'S', 95, 93, ['MUSCLE', 'FLEX'], ['#b8201c', '#d6a419'], 'figure', 'Undefeated, unbothered, and standing right behind you.'),
      lot('squad', 2, 'Ex-Special-Forces Tactical Unit', 'S', 91, 84, ['MUSCLE', 'STEALTH'], ['#3d4a38', '#9aa58a'], 'shield', 'You will never see them. That is the point.'),
      lot('squad', 3, 'Kung Fu Grandmaster', 'A', 84, 66, ['MUSCLE', 'STEALTH'], ['#d0782a', '#f1e6cf'], 'figure', 'Seventy-one years old. Has not lost since before colour television.'),
      lot('squad', 4, 'Viking Berserker', 'A', 80, 76, ['MUSCLE', 'CHAOS'], ['#8a5a30', '#c8ccd0'], 'figure', 'Excellent in a crisis. Is usually the crisis.'),
      lot('squad', 5, 'Prime Boxer-YouTuber', 'A', 75, 89, ['UK_LEGEND', 'MUSCLE'], ['#c23b3b', '#f4f1e8'], 'figure', 'Sold out an arena, dropped a single, and still replied to the comments.'),
      lot('squad', 6, 'Angry Goose Swarm', 'B', 57, 40, ['CHAOS', 'UK_LEGEND'], ['#e8e8e0', '#e08a2a'], 'wheel', 'Forty geese. No off switch. Canal-side veterans.'),
      lot('squad', 7, 'Mall Security Guard', 'C', 26, 25, ['BUDGET_KING', 'MUSCLE'], ['#3b5c8a', '#d9d9d9'], 'shield', 'Has a torch, a lanyard, and a strongly worded whistle.'),
      lot('squad', 8, 'Toddler on Sugar', 'CURSED', 12, 20, ['CHAOS', 'SPEED_DEMON'], ['#f08ab0', '#7fd0e8'], 'figure', 'Fast, sticky, and impossible to reason with.'),
    ],
  },
  {
    id: 'drip',
    name: 'Luxury & Drip',
    short: 'DRIP',
    blurb: 'The fit. The piece. The thing people screenshot.',
    items: [
      lot('drip', 1, 'Iced-Out Tourbillon Watch', 'S', 94, 92, ['FLEX', 'BILLIONAIRE'], ['#cfe6f2', '#d6a419'], 'ring', 'Tells the time. Mostly tells people you can afford it.'),
      lot('drip', 2, '1-of-1 Couture Archive', 'S', 88, 74, ['FLEX', 'STEALTH'], ['#1d1d1f', '#c9b48a'], 'gem', 'Never worn, never photographed, never coming up again.'),
      lot('drip', 3, 'Golden Squad Chain', 'A', 81, 83, ['UK_LEGEND', 'FLEX'], ['#d6a419', '#8a6a10'], 'ring', 'Heavy enough to count as a gym membership.'),
      lot('drip', 4, 'Diamond Grillz', 'A', 73, 80, ['FLEX', 'CHAOS'], ['#dff1f7', '#9ad0e0'], 'gem', 'Every smile is a jewellery advert. Soup is now difficult.'),
      lot('drip', 5, 'Limited Hyper-Sneakers', 'B', 64, 78, ['SPEED_DEMON', 'FLEX'], ['#e8442e', '#f4f1e8'], 'shoe', 'Queued for nine hours. Too precious to walk in.'),
      lot('drip', 6, 'Thrift Store Tracksuit', 'C', 40, 28, ['UK_LEGEND', 'BUDGET_KING'], ['#2e4a8a', '#e8e8e8'], 'box', 'Three stripes, two owners, one mystery stain.'),
      lot('drip', 7, 'Foam Clogs in Sport Mode', 'C', 31, 36, ['SPEED_DEMON', 'BUDGET_KING'], ['#7ac74f', '#f4e04d'], 'shoe', 'Strap down means business.'),
      lot('drip', 8, 'Fake Designer Belt', 'CURSED', 8, 30, ['BUDGET_KING', 'FLEX'], ['#5a3a1e', '#c9a227'], 'ring', 'The logo is spelled almost correctly.'),
    ],
  },
  {
    id: 'tech',
    name: 'Tech & Gadgets',
    short: 'TECH',
    blurb: 'Hardware for the lineup. Some of it even turns on.',
    items: [
      lot('tech', 1, 'Quantum Supercomputer', 'S', 96, 88, ['TECH_HEAD', 'BILLIONAIRE'], ['#3fb8c9', '#d6a419'], 'chip', 'It has already calculated what you will bid. Go on, surprise it.'),
      lot('tech', 2, 'Jetpack Mk.IV', 'S', 90, 95, ['SPEED_DEMON', 'TECH_HEAD'], ['#c9ccd1', '#e8642e'], 'rocket', 'Marks one to three are why there is a mark four.'),
      lot('tech', 3, 'Neural VR Rig', 'A', 79, 77, ['TECH_HEAD', 'STEALTH'], ['#2b2f36', '#56b6d8'], 'eye', 'Plugs straight in. Please read the terms. Nobody reads the terms.'),
      lot('tech', 4, 'AI Butler Drone', 'A', 72, 68, ['TECH_HEAD', 'FLEX'], ['#e8e8e8', '#3a9a8c'], 'rocket', 'Brings the tea, files the taxes, judges you quietly.'),
      lot('tech', 5, 'Indestructible Brick Phone', 'B', 65, 52, ['NOSTALGIA', 'MUSCLE'], ['#2e4a6a', '#9ab0c4'], 'phone', 'Battery lasts a fortnight. Has survived things you have not.'),
      lot('tech', 6, 'Dial-Up Router', 'C', 27, 18, ['NOSTALGIA', 'BUDGET_KING'], ['#c8c2b0', '#5a8a3c'], 'chip', 'Sings the song of its people every time you connect.'),
      lot('tech', 7, 'Broken Gamepad (Stick Drift)', 'C', 22, 26, ['NOSTALGIA', 'CHAOS'], ['#2a2a2e', '#4fb04f'], 'phone', 'Always walking slightly left. So will your lineup.'),
      lot('tech', 8, 'Potato Battery', 'CURSED', 10, 14, ['BUDGET_KING', 'TECH_HEAD'], ['#a8843c', '#c9c9c9'], 'brick', 'Zero point eight volts of pure ambition.'),
    ],
  },
]);

// The eighth category is never drafted as a round. Its lots arrive sealed, mid-show.
export const MYSTERY_CATEGORY = Object.freeze({
  id: 'vault',
  name: 'Mystery Vault Crates',
  short: 'CRATE',
  blurb: 'Sold blind. A silhouette, one clue, and your nerve.',
  items: [
    lot('vault', 1, 'Secret Billionaire Inheritance', 'S', 100, 50, ['BILLIONAIRE', 'FLEX'], ['#d6a419', '#f4f1e8'], 'gem', 'A great-uncle you never met has left you everything.'),
    lot('vault', 2, 'Deed to a Grand Prix Team', 'S', 92, 50, ['SPEED_DEMON', 'BILLIONAIRE'], ['#c9261e', '#e8e8e8'], 'car', 'Two cars, a wind tunnel, and four hundred staff who now work for you.'),
    lot('vault', 3, 'Lost Platinum Master Tape', 'A', 85, 50, ['NOSTALGIA', 'UK_LEGEND'], ['#c9ccd1', '#2b2f36'], 'ring', 'The album that never came out. It is very, very good.'),
    lot('vault', 4, 'Lifetime Front-Row Pass', 'B', 62, 50, ['FLEX', 'UK_LEGEND'], ['#b32020', '#d6a419'], 'crown', 'Every final, every premiere, every fight. Forever.'),
    lot('vault', 5, 'Haunted Karaoke Machine', 'C', 20, 50, ['CHAOS', 'NOSTALGIA'], ['#7a5fd0', '#39b36b'], 'phone', 'It only plays one song, and it starts by itself at 3 a.m.'),
    lot('vault', 6, 'Box of 400 Left Shoes', 'CURSED', 8, 50, ['BUDGET_KING', 'CHAOS'], ['#8a5a30', '#c8c2b0'], 'shoe', 'Four hundred. All left. All size eleven.'),
    lot('vault', 7, 'A Literal Brick', 'CURSED', 5, 50, ['BUDGET_KING', 'MUSCLE'], ['#a8482e', '#7a3420'], 'brick', 'It is a brick. We did warn you.'),
    lot('vault', 8, 'Cursed Tax Audit', 'CURSED', 2, 50, ['CHAOS'], ['#3b2a4a', '#6fae4f'], 'box', 'Seven years of receipts. They would like to see all of them.'),
  ],
});

export const CRATE_CLUES = Object.freeze([
  'Worth ten million, or a literal brick.',
  'The last owner left the country in a hurry.',
  'Heavier than it looks. Or much, much lighter.',
  'Customs opened it once and closed it again quickly.',
  'It hums. We have chosen not to ask why.',
  'Could retire you. Could ruin you. Sealed since 1997.',
  'The insurer valued it at "do not ask".',
  'Our lawyers say we may only describe it as "an item".',
]);

// $0 fillers handed to anyone who ends a category without a lot.
export const PENALTY_DUDS = Object.freeze([
  { name: 'Rusty Shopping Trolley', line: 'One wheel has its own ideas.' },
  { name: '144p Webcam', line: 'You look like a witness-protection interview.' },
  { name: 'Half a Sandwich (Yesterday\'s)', line: 'The good half is the one that is missing.' },
  { name: 'Participation Ribbon', line: 'It says "You Tried" and it means it.' },
  { name: 'Expired Gym Day-Pass', line: 'Valid until a date three years ago.' },
  { name: 'Single Wet Sock', line: 'Origin unknown. Dampness permanent.' },
  { name: 'Charger for a Phone Nobody Makes', line: 'Thirty pins. None of them yours.' },
  { name: 'Traffic Cone (Borrowed)', line: 'Technically council property.' },
]);

export function makeDud(index, categoryId) {
  const d = PENALTY_DUDS[index % PENALTY_DUDS.length];
  return Object.freeze({
    id: `dud-${categoryId}-${index}`,
    name: d.name,
    category: categoryId,
    tier: 'DUD',
    trueValue: 0,
    baseAppeal: 0,
    synergyTags: Object.freeze([]),
    colorPalette: Object.freeze(['#6b6f74', '#3a3d41']),
    proceduralIconType: 'box',
    commentaryLine: d.line,
    dud: true,
  });
}

export function allItems() {
  return [...CATEGORIES.flatMap((c) => c.items), ...MYSTERY_CATEGORY.items];
}

export function categoryById(id) {
  return CATEGORIES.find((c) => c.id === id) || (id === MYSTERY_CATEGORY.id ? MYSTERY_CATEGORY : null);
}

// Hype is shown as 1-5 lamps.
export function hypeLamps(item) {
  return Math.max(1, Math.min(5, Math.ceil(item.baseAppeal / 20)));
}
