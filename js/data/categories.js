// BIDLOCK 2.0 — lot database.
// 14 categories x 10 lots = 140 lots. `trueValue` and `tier` are sealed until the verdict;
// `baseAppeal` ("hype") is public and deliberately imperfect: some lots are overhyped,
// some are sleepers. Synergy tags are public so a lineup can be planned around them.
// `wikiQuery` is the Wikipedia article whose lead photograph is shown for the lot.

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

function build(def) {
  const palette = Object.freeze(def.palette);
  const items = def.lots.map(([name, tier, trueValue, baseAppeal, synergyTags, wikiQuery, commentaryLine], i) => Object.freeze({
    id: `${def.id}-${i + 1}`,
    name,
    category: def.id,
    tier,
    trueValue,
    baseAppeal,
    synergyTags: Object.freeze(synergyTags),
    colorPalette: palette,
    proceduralIconType: def.icon,
    wikiQuery,
    commentaryLine,
  }));
  return Object.freeze({ id: def.id, name: def.name, short: def.short, blurb: def.blurb, icon: def.icon, palette, items: Object.freeze(items) });
}

export const CATEGORIES = Object.freeze([
  build({
    id: 'estates', name: 'Dream Mansions & Estates', short: 'ESTATE', icon: 'house', palette: ['#b9502e', '#eadfc8'],
    blurb: 'Where the lineup sleeps. Square footage is a personality.',
    lots: [
      ['Private Caribbean Cay', 'S', 97, 96, ['BILLIONAIRE', 'STEALTH'], 'Necker Island (British Virgin Islands)', 'Its own reef, its own runway, its own postcode.'],
      ['Cliffside Masterpiece', 'S', 91, 82, ['FLEX', 'NOSTALGIA'], 'Fallingwater', 'A house built over a waterfall. The damp is considered a feature.'],
      ['Modern Glass Villa', 'A', 86, 88, ['FLEX', 'BILLIONAIRE'], 'Farnsworth House', 'Floor-to-ceiling glass. Do not own a football.'],
      ['Fairytale Castle', 'A', 84, 92, ['NOSTALGIA', 'FLEX'], 'Neuschwanstein Castle', 'Turrets, a throne room, and a heating bill with its own turret.'],
      ['Tokyo Penthouse', 'A', 78, 85, ['FLEX', 'TECH_HEAD'], 'Roppongi Hills Mori Tower', 'Fifty floors up. The lift has better manners than you do.'],
      ['Swiss Alpine Chalet', 'A', 80, 74, ['STEALTH', 'NOSTALGIA'], 'Chalet', 'Log fire, cuckoo clock, neighbours who mind their own business.'],
      ['Converted Lighthouse', 'B', 62, 55, ['STEALTH', 'UK_LEGEND'], 'Lighthouse', 'Round rooms, one very large lamp, no passing trade.'],
      ['Brutalist Bunker', 'B', 58, 38, ['STEALTH', 'MUSCLE'], 'Habitat 67', 'Concrete. More concrete. A sleeper, if you squint.'],
      ['Luxury Treehouse', 'C', 36, 50, ['STEALTH', 'BUDGET_KING'], 'Tree house', 'Underfloor heating, rope ladder, squirrels on the lease.'],
      ['Garden Shed', 'CURSED', 6, 12, ['BUDGET_KING', 'UK_LEGEND'], 'Shed', 'Sleeps one, alongside a lawnmower and nine spiders.'],
    ],
  }),
  build({
    id: 'rides', name: 'Hypercars & Exotic Rides', short: 'RIDES', icon: 'car', palette: ['#c9261e', '#15171a'],
    blurb: 'What is parked outside says everything. Or nothing, if it is a unicycle.',
    lots: [
      ['Bugatti Chiron', 'S', 96, 95, ['SPEED_DEMON', 'BILLIONAIRE'], 'Bugatti Chiron', 'Sixteen cylinders, four turbos, and a service bill like a house deposit.'],
      ['Koenigsegg Jesko', 'S', 94, 84, ['SPEED_DEMON', 'TECH_HEAD'], 'Koenigsegg Jesko', 'Built by a few dozen Swedes who think 300 miles an hour is a starting point.'],
      ['McLaren F1', 'S', 93, 80, ['SPEED_DEMON', 'UK_LEGEND'], 'McLaren F1', 'Three seats, the driver in the middle, gold foil in the engine bay.'],
      ['Nissan Skyline GT-R R34', 'A', 88, 70, ['SPEED_DEMON', 'NOSTALGIA'], 'Nissan Skyline GT-R', 'One poster on every bedroom wall since 1999.'],
      ['Rolls-Royce Boat Tail', 'A', 85, 78, ['BILLIONAIRE', 'FLEX'], 'Rolls-Royce Boat Tail', 'The boot opens into a champagne picnic. Obviously.'],
      ['G-Wagon 6x6', 'A', 74, 90, ['FLEX', 'MUSCLE'], 'Mercedes-Benz G-Class', 'Six wheels, zero subtlety, never once been off-road.'],
      ['Original Mini', 'B', 60, 50, ['UK_LEGEND', 'NOSTALGIA'], 'Mini', 'Fits anywhere. Has been driven down a staircase on film.'],
      ['Peel P50', 'C', 34, 58, ['BUDGET_KING', 'UK_LEGEND'], 'Peel P50', 'The smallest production car ever made. Reverse gear is you, lifting it.'],
      ['Three-Wheeler', 'C', 30, 35, ['UK_LEGEND', 'CHAOS'], 'Reliant Robin', 'Corners enthusiastically. Sometimes all the way over.'],
      ['Unicycle', 'CURSED', 7, 12, ['CHAOS', 'BUDGET_KING'], 'Unicycle', 'Half the wheels, none of the dignity.'],
    ],
  }),
  build({
    id: 'icons', name: 'Internet & Pop Culture Icons', short: 'ICONS', icon: 'star', palette: ['#e0559b', '#f6c94a'],
    blurb: 'The things the internet could not stop posting.',
    lots: [
      ['The Original Doge', 'S', 92, 96, ['CHAOS', 'NOSTALGIA'], 'Shiba Inu', 'Much lot. Very auction. Wow.'],
      ['Rubik\'s Cube', 'S', 90, 72, ['NOSTALGIA', 'TECH_HEAD'], 'Rubik\'s Cube', 'Forty-three quintillion positions and you still peel the stickers off.'],
      ['Original Game Boy', 'A', 86, 80, ['NOSTALGIA', 'TECH_HEAD'], 'Game Boy', 'Four shades of green and a battery life modern phones dream about.'],
      ['Grumpy Cat', 'A', 80, 84, ['CHAOS', 'NOSTALGIA'], 'Grumpy Cat', 'Unimpressed by you, by this auction, and by the price so far.'],
      ['Nokia 3310', 'A', 78, 66, ['NOSTALGIA', 'MUSCLE'], 'Nokia 3310', 'Battery lasts a fortnight. Has survived things you have not.'],
      ['Tamagotchi', 'B', 60, 62, ['NOSTALGIA', 'CHAOS'], 'Tamagotchi', 'It needs feeding. It always needs feeding.'],
      ['Rubber Duck', 'B', 55, 40, ['BUDGET_KING', 'CHAOS'], 'Rubber duck', 'Explain your problems to it. It has heard worse.'],
      ['Lava Lamp', 'C', 38, 45, ['NOSTALGIA', 'FLEX'], 'Lava lamp', 'Takes an hour to warm up. So did the seventies.'],
      ['Fidget Spinner', 'C', 24, 60, ['BUDGET_KING', 'SPEED_DEMON'], 'Fidget spinner', 'Peaked in one summer. Everyone remembers which one.'],
      ['Stadium Air Horn', 'CURSED', 5, 30, ['CHAOS', 'BUDGET_KING'], 'Air horn', 'One note. For ninety minutes. Plus stoppage time.'],
    ],
  }),
  build({
    id: 'beasts', name: 'Apex Predators & Exotic Pets', short: 'BEASTS', icon: 'paw', palette: ['#4f8a3c', '#e8d9a8'],
    blurb: 'Something has to guard the garden. Or just sit in it looking calm.',
    lots: [
      ['Snow Leopard', 'S', 95, 90, ['STEALTH', 'FLEX'], 'Snow leopard', 'You will never see it coming. Neither will the postman.'],
      ['Peregrine Falcon', 'S', 91, 76, ['SPEED_DEMON', 'STEALTH'], 'Peregrine falcon', 'The fastest animal alive, in a dive. Bad news for pigeons.'],
      ['Orca', 'A', 88, 86, ['MUSCLE', 'STEALTH'], 'Orca', 'Six tonnes, hunts in a team, needs a bigger pool than you have.'],
      ['Honey Badger', 'A', 84, 62, ['CHAOS', 'MUSCLE'], 'Honey badger', 'Fights lions, eats cobras, has no opinion about any of it.'],
      ['Komodo Dragon', 'A', 82, 80, ['MUSCLE', 'CHAOS'], 'Komodo dragon', 'Three metres of lizard with a patient attitude to lunch.'],
      ['Capybara', 'B', 66, 92, ['CHAOS', 'BUDGET_KING'], 'Capybara', 'Friends with everybody. Does absolutely nothing. Adored.'],
      ['Axolotl', 'B', 58, 70, ['STEALTH', 'NOSTALGIA'], 'Axolotl', 'Smiles constantly. Regrows limbs. Never grows up.'],
      ['Llama', 'C', 40, 44, ['CHAOS', 'BUDGET_KING'], 'Llama', 'Will carry your bags. Will spit on your guests.'],
      ['Goldfish', 'C', 22, 20, ['BUDGET_KING', 'NOSTALGIA'], 'Goldfish', 'Won at a funfair. Outlived the funfair.'],
      ['Town-Centre Pigeon', 'CURSED', 8, 10, ['UK_LEGEND', 'BUDGET_KING'], 'Feral pigeon', 'One good foot and strong views on your chips.'],
    ],
  }),
  build({
    id: 'drip', name: 'Luxury Watches, Drip & Artifacts', short: 'DRIP', icon: 'gem', palette: ['#d6a419', '#1d1d1f'],
    blurb: 'The fit. The piece. The thing people screenshot.',
    lots: [
      ['Omega Speedmaster Moonwatch', 'S', 95, 92, ['FLEX', 'BILLIONAIRE'], 'Omega Speedmaster', 'It has been to the Moon. You will wear it to the shops.'],
      ['Rolex Daytona', 'S', 90, 94, ['FLEX', 'SPEED_DEMON'], 'Rolex Daytona', 'Times a lap to the eighth of a second. You will use it for eggs.'],
      ['Fabergé Egg', 'A', 88, 78, ['BILLIONAIRE', 'NOSTALGIA'], 'Fabergé egg', 'An Easter present from a tsar. Do not make an omelette.'],
      ['The Hope Diamond', 'A', 86, 85, ['BILLIONAIRE', 'STEALTH'], 'Hope Diamond', 'Forty-five carats, deep blue, allegedly cursed. Allegedly.'],
      ['St Edward\'s Crown', 'A', 82, 80, ['UK_LEGEND', 'BILLIONAIRE'], 'St Edward\'s Crown', 'Two kilos of gold. Worn for about an hour per reign.'],
      ['Deadstock Air Force 1s', 'B', 68, 88, ['FLEX', 'SPEED_DEMON'], 'Air Force 1 (shoe)', 'Queued nine hours. Too precious to walk in.'],
      ['Savile Row Suit', 'B', 64, 52, ['UK_LEGEND', 'FLEX'], 'Savile Row', 'Fifty hours of hand stitching. You will still spill something on it.'],
      ['Bowler Hat', 'C', 36, 40, ['UK_LEGEND', 'NOSTALGIA'], 'Bowler hat', 'Very City of London, 1955.'],
      ['Wooden Clogs', 'C', 28, 55, ['BUDGET_KING', 'CHAOS'], 'Clog', 'No strap, no sport mode. Everyone hears you coming.'],
      ['Bum Bag', 'CURSED', 9, 25, ['BUDGET_KING', 'NOSTALGIA'], 'Fanny pack', 'Holds a phone, some keys and your remaining pride.'],
    ],
  }),
  build({
    id: 'guards', name: 'Elite Bodyguards & Warriors', short: 'GUARDS', icon: 'shield', palette: ['#3d4a38', '#d6a419'],
    blurb: 'Somebody has to stand behind you looking serious.',
    lots: [
      ['Samurai', 'S', 94, 92, ['MUSCLE', 'STEALTH'], 'Samurai', 'Two swords, a strict code, and no patience for late bidders.'],
      ['Spartan Hoplite', 'S', 92, 88, ['MUSCLE', 'NOSTALGIA'], 'Hoplite', 'Comes back with his shield or on it.'],
      ['Gurkha', 'A', 88, 64, ['MUSCLE', 'STEALTH'], 'Gurkha', 'Better to die than be a coward. The room should bid accordingly.'],
      ['Viking Berserker', 'A', 80, 82, ['MUSCLE', 'CHAOS'], 'Vikings', 'Excellent in a crisis. Is usually the crisis.'],
      ['Ninja', 'A', 78, 90, ['STEALTH', 'SPEED_DEMON'], 'Ninja', 'You have probably already bought one. You would not know.'],
      ['Knight in Plate Armour', 'B', 70, 75, ['MUSCLE', 'UK_LEGEND'], 'Knight', 'Unstoppable on a horse. Needs a hand with stairs.'],
      ['Sumo Wrestler', 'B', 64, 58, ['MUSCLE', 'FLEX'], 'Sumo', 'Nobody gets past. Nobody gets round, either.'],
      ['King\'s Guard', 'C', 40, 66, ['UK_LEGEND', 'NOSTALGIA'], 'King\'s Guard', 'Will not move, will not smile, will not actually help.'],
      ['Mall Security Guard', 'C', 26, 25, ['BUDGET_KING', 'MUSCLE'], 'Security guard', 'Has a torch, a lanyard and a strongly worded whistle.'],
      ['Scarecrow', 'CURSED', 6, 14, ['BUDGET_KING', 'STEALTH'], 'Scarecrow', 'Outstanding against crows. Limited against everything else.'],
    ],
  }),
  build({
    id: 'powers', name: 'Superpowers & Reality Glitches', short: 'POWERS', icon: 'bolt', palette: ['#7a5fd0', '#d9d2f5'],
    blurb: 'One power, permanent, no refunds. Read the small print.',
    lots: [
      ['Time Freeze (10s)', 'S', 95, 90, ['STEALTH', 'TECH_HEAD'], 'Hourglass', 'Ten seconds. Long enough to win any argument, or leave it.'],
      ['Teleportation', 'S', 92, 94, ['SPEED_DEMON', 'STEALTH'], 'Wormhole', 'No more airports. No more "five minutes away".'],
      ['Flight', 'A', 86, 92, ['SPEED_DEMON', 'FLEX'], 'Wingsuit flying', 'Cold, loud, full of insects. Still flight.'],
      ['Mind Reading', 'A', 82, 75, ['STEALTH', 'CHAOS'], 'Human brain', 'You will know exactly what they think of you. Good luck with that.'],
      ['Super Strength', 'A', 78, 80, ['MUSCLE', 'FLEX'], 'Farnese Atlas', 'Carry the whole sky. Or all the shopping in one trip.'],
      ['Infinite Rizz', 'B', 68, 85, ['FLEX', 'UK_LEGEND'], 'Peafowl', 'Every text gets a reply. Every reply is a yes.'],
      ['Talk to Animals', 'B', 60, 55, ['CHAOS', 'NOSTALGIA'], 'Parrot', 'They mostly want to talk about food. So do you.'],
      ['Lag Switch IRL', 'C', 34, 30, ['TECH_HEAD', 'CHAOS'], 'Sloth', 'Everyone around you slows right down. So do you.'],
      ['Invisibility (Only When Nobody Looks)', 'C', 30, 55, ['STEALTH', 'CHAOS'], 'Chameleon', 'Works perfectly. Nobody has ever been able to confirm it.'],
      ['Always Steps on a Brick', 'CURSED', 4, 8, ['CHAOS'], 'Lego', 'It is a power in the sense that it is permanent.'],
    ],
  }),
  build({
    id: 'tech', name: 'Next-Gen Tech & Military Hardware', short: 'TECH', icon: 'chip', palette: ['#3fb8c9', '#22262b'],
    blurb: 'Hardware for the lineup. Some of it is even legal to own.',
    lots: [
      ['Quantum Computer', 'S', 96, 86, ['TECH_HEAD', 'BILLIONAIRE'], 'Quantum computing', 'It has already calculated what you will bid. Go on, surprise it.'],
      ['F-22 Raptor', 'S', 93, 94, ['SPEED_DEMON', 'MUSCLE'], 'Lockheed Martin F-22 Raptor', 'Invisible to radar. Very visible on the driveway.'],
      ['Jetpack', 'A', 84, 92, ['SPEED_DEMON', 'TECH_HEAD'], 'Jet pack', 'Thirty seconds of flight and a lifetime of telling people about it.'],
      ['Robot Pack Mule', 'A', 80, 72, ['TECH_HEAD', 'CHAOS'], 'BigDog', 'Carries 150 kilos over ice. Sounds like an angry lawnmower.'],
      ['Main Battle Tank', 'A', 78, 80, ['MUSCLE', 'UK_LEGEND'], 'Challenger 2', 'Sixty-two tonnes. Has a kettle built in. This is true.'],
      ['Enigma Machine', 'B', 70, 60, ['STEALTH', 'NOSTALGIA'], 'Enigma machine', 'Unbreakable, they said. Then a few mathematicians got involved.'],
      ['Night-Vision Goggles', 'B', 62, 58, ['STEALTH', 'TECH_HEAD'], 'Night-vision device', 'Everything is green. You are now a nature documentary.'],
      ['Segway', 'C', 35, 50, ['TECH_HEAD', 'BUDGET_KING'], 'Segway', 'The future of transport, in 2001.'],
      ['Dial-Up Modem', 'C', 24, 15, ['NOSTALGIA', 'BUDGET_KING'], 'Modem', 'Sings the song of its people every time you connect.'],
      ['Fruit Battery', 'CURSED', 9, 14, ['BUDGET_KING', 'TECH_HEAD'], 'Lemon battery', 'Zero point nine volts of pure ambition.'],
    ],
  }),
  build({
    id: 'escape', name: 'Private Jets, Yachts & Bunkers', short: 'JETS', icon: 'plane', palette: ['#8fc4d6', '#2b3238'],
    blurb: 'How you leave, and where you hide when you get there.',
    lots: [
      ['Gulfstream G650', 'S', 95, 93, ['BILLIONAIRE', 'SPEED_DEMON'], 'Gulfstream G650', 'London to Singapore non-stop, in slippers.'],
      ['Concorde', 'S', 92, 88, ['SPEED_DEMON', 'NOSTALGIA'], 'Concorde', 'Twice the speed of sound. You land before you took off.'],
      ['Superyacht', 'A', 88, 97, ['BILLIONAIRE', 'FLEX'], 'Superyacht', 'It has a helipad. The helipad has a smaller boat.'],
      ['Private Submersible', 'A', 82, 68, ['STEALTH', 'TECH_HEAD'], 'Submersible', 'Nobody can reach you. Nobody. That is the selling point.'],
      ['Helicopter', 'A', 76, 80, ['SPEED_DEMON', 'FLEX'], 'Helicopter', 'Skips the traffic. Annoys an entire postcode.'],
      ['Doomsday Bunker', 'B', 68, 52, ['STEALTH', 'MUSCLE'], 'Bunker', 'Two metres of concrete and forty years of tinned peaches.'],
      ['Airship', 'B', 60, 62, ['NOSTALGIA', 'FLEX'], 'Zeppelin', 'Stately, silent, slow. Avoid sparks.'],
      ['Narrowboat', 'C', 42, 30, ['UK_LEGEND', 'BUDGET_KING'], 'Narrowboat', 'Four miles an hour and a kettle that is always on.'],
      ['Pedalo', 'C', 20, 22, ['BUDGET_KING', 'CHAOS'], 'Pedalo', 'You are the engine. The engine is tired.'],
      ['Inflatable Dinghy', 'CURSED', 7, 10, ['BUDGET_KING', 'CHAOS'], 'Inflatable boat', 'Slow puncture included at no extra cost.'],
    ],
  }),
  build({
    id: 'feast', name: 'Michelin Feasts & Unlimited Food Pass', short: 'FEAST', icon: 'plate', palette: ['#c9762a', '#f0d9a8'],
    blurb: 'One thing to eat, for ever. Choose like you mean it.',
    lots: [
      ['Omakase Sushi for Life', 'S', 94, 90, ['FLEX', 'STEALTH'], 'Sushi', 'The chef decides. The chef is always right.'],
      ['A5 Wagyu Supply', 'S', 92, 94, ['FLEX', 'BILLIONAIRE'], 'Wagyu', 'The cows get massages. You get the bill.'],
      ['Neapolitan Pizza Pass', 'A', 86, 88, ['NOSTALGIA', 'CHAOS'], 'Neapolitan pizza', 'Ninety seconds in the oven. Gone in sixty.'],
      ['White Truffle Supply', 'A', 84, 70, ['BILLIONAIRE', 'STEALTH'], 'Truffle', 'Found by a dog, shaved by a waiter, priced by a comedian.'],
      ['Full English, Every Morning', 'A', 74, 66, ['UK_LEGEND', 'NOSTALGIA'], 'Full breakfast', 'Beans touching the egg. That is the law.'],
      ['Fish and Chips Friday', 'B', 66, 60, ['UK_LEGEND', 'BUDGET_KING'], 'Fish and chips', 'Salt, vinegar, and a wooden fork that does nothing.'],
      ['Unlimited Chicken Wings', 'B', 62, 80, ['CHAOS', 'BUDGET_KING'], 'Buffalo wing', 'Unlimited. Napkins not included.'],
      ['Beluga Caviar on Tap', 'B', 58, 86, ['BILLIONAIRE', 'FLEX'], 'Caviar', 'Tastes like the sea charging you rent.'],
      ['Instant Noodles', 'C', 30, 28, ['BUDGET_KING', 'NOSTALGIA'], 'Instant noodles', 'Three minutes. Student years, in a bowl.'],
      ['Fermented Herring', 'CURSED', 3, 12, ['CHAOS'], 'Surströmming', 'Open it outdoors. Further outdoors than that.'],
    ],
  }),
  build({
    id: 'props', name: 'Iconic Movie Props & Vehicles', short: 'PROPS', icon: 'film', palette: ['#2f6fd0', '#e8e8e8'],
    blurb: 'Straight off the set. Mileage unknown, some of it through time.',
    lots: [
      ['DeLorean Time Machine', 'S', 96, 95, ['NOSTALGIA', 'SPEED_DEMON'], 'DeLorean time machine', 'Needs 1.21 gigawatts and a long, straight road.'],
      ['Submarine Spy Car', 'S', 93, 92, ['STEALTH', 'TECH_HEAD'], 'Wet Nellie', 'Drives off the pier, keeps going. Wipers optional.'],
      ['Powered Armour Suit', 'A', 88, 96, ['TECH_HEAD', 'FLEX'], 'Powered exoskeleton', 'Genius, billionaire and playboy sold separately.'],
      ['Lightsaber', 'A', 86, 94, ['TECH_HEAD', 'NOSTALGIA'], 'Lightsaber', 'An elegant weapon. Terrible for slicing bread.'],
      ['Spy\'s Aston Martin DB5', 'A', 84, 82, ['UK_LEGEND', 'STEALTH'], 'Aston Martin DB5', 'Ejector seat fitted. Passengers are advised to be polite.'],
      ['The One Ring', 'B', 72, 84, ['STEALTH', 'NOSTALGIA'], 'One Ring', 'Makes you invisible. Minor side effects.'],
      ['Ruby Slippers', 'B', 66, 60, ['NOSTALGIA', 'FLEX'], 'Ruby slippers', 'Click three times. Results may vary outside Kansas.'],
      ['Love Bug Beetle', 'B', 62, 74, ['NOSTALGIA', 'CHAOS'], 'Herbie', 'Number 53. Drives itself. Has opinions about your parking.'],
      ['Clapperboard', 'C', 35, 30, ['NOSTALGIA', 'BUDGET_KING'], 'Clapperboard', 'Scene one, take forty. Still no bids.'],
      ['Stale Cinema Popcorn', 'CURSED', 8, 20, ['BUDGET_KING', 'CHAOS'], 'Popcorn', 'Swept up after the late showing. Lightly buttered, heavily trodden.'],
    ],
  }),
  build({
    id: 'wonders', name: 'World Wonders & Secret Locations', short: 'WONDERS', icon: 'peak', palette: ['#2f9e8f', '#e9d9a6'],
    blurb: 'The deeds to somewhere extraordinary. Or to a roundabout.',
    lots: [
      ['Great Pyramid of Giza', 'S', 96, 95, ['BILLIONAIRE', 'NOSTALGIA'], 'Great Pyramid of Giza', 'Four and a half thousand years old. One careful owner.'],
      ['Machu Picchu', 'S', 95, 92, ['STEALTH', 'NOSTALGIA'], 'Machu Picchu', 'A city in the clouds that nobody told the conquistadors about.'],
      ['Petra', 'A', 86, 80, ['STEALTH', 'NOSTALGIA'], 'Petra', 'A whole city carved into a cliff. The front door alone is forty metres.'],
      ['Everest Summit', 'A', 84, 88, ['MUSCLE', 'FLEX'], 'Mount Everest', 'The view is unbeatable. So is the queue.'],
      ['Area 51', 'A', 82, 90, ['STEALTH', 'TECH_HEAD'], 'Area 51', 'We cannot confirm what is inside. We cannot confirm this lot exists.'],
      ['Stonehenge', 'A', 78, 84, ['UK_LEGEND', 'NOSTALGIA'], 'Stonehenge', 'Nobody knows what it is for. Planning permission was simpler then.'],
      ['Arctic Seed Vault', 'B', 70, 48, ['STEALTH', 'TECH_HEAD'], 'Svalbard Global Seed Vault', 'A million seed samples inside a frozen mountain. A sleeper for the end of the world.'],
      ['Loch Ness', 'B', 60, 72, ['UK_LEGEND', 'CHAOS'], 'Loch Ness', 'Monster not guaranteed. Midges are.'],
      ['Motorway Services', 'C', 22, 15, ['UK_LEGEND', 'BUDGET_KING'], 'Motorway service area', 'A nine-pound sandwich and a massage chair nobody has ever used.'],
      ['A Roundabout', 'CURSED', 6, 8, ['UK_LEGEND', 'CHAOS'], 'Roundabout', 'You now own a roundabout. Give way to the right.'],
    ],
  }),
  build({
    id: 'troll', name: 'Cursed Bargains & Troll Lots', short: 'TROLL', icon: 'cone', palette: ['#e8642e', '#f4e04d'],
    blurb: 'Mostly rubbish. Mostly. In this round the hype lamps lie.',
    lots: [
      ['One Red Paperclip', 'S', 90, 20, ['BUDGET_KING', 'CHAOS'], 'Paper clip', 'Somebody once traded one of these, fourteen swaps later, for a house.'],
      ['Tulip Mania Bulb', 'S', 86, 30, ['BILLIONAIRE', 'NOSTALGIA'], 'Tulip mania', 'In 1637 one bulb cost more than a canal house. Timing is everything.'],
      ['Pet Rock', 'A', 72, 35, ['NOSTALGIA', 'BUDGET_KING'], 'Pet Rock', 'Made its inventor a millionaire. House-trained.'],
      ['Garden Gnome', 'B', 55, 40, ['UK_LEGEND', 'CHAOS'], 'Garden gnome', 'Has seen everything that happens on your lawn. Says nothing.'],
      ['Rubber Chicken', 'B', 50, 45, ['CHAOS', 'BUDGET_KING'], 'Rubber chicken', 'Comedy gold since the 1800s. Squeak sold separately.'],
      ['Traffic Cone', 'C', 30, 25, ['UK_LEGEND', 'CHAOS'], 'Traffic cone', 'Technically council property. Traditionally worn by statues.'],
      ['Shopping Trolley', 'C', 26, 30, ['BUDGET_KING', 'SPEED_DEMON'], 'Shopping cart', 'One wheel has its own ideas.'],
      ['Portable Toilet', 'C', 18, 50, ['STEALTH', 'BUDGET_KING'], 'Portable toilet', 'Festival used. Day four.'],
      ['Single Sock', 'CURSED', 5, 10, ['BUDGET_KING'], 'Sock', 'Its partner left years ago. No forwarding address.'],
      ['Banana Peel', 'CURSED', 3, 60, ['CHAOS', 'SPEED_DEMON'], 'Banana peel', 'Hugely hyped by people who want to watch you slip.'],
    ],
  }),
]);

// The fourteenth category is never drafted as a round. Its lots arrive sealed, mid-show,
// and the photograph is only shown once the winner opens the crate.
export const MYSTERY_CATEGORY = build({
  id: 'vault', name: 'Mystery Vault Crates', short: 'CRATE', icon: 'crate', palette: ['#6b4a26', '#d6a419'],
  blurb: 'Sold blind. A silhouette, one clue, and your nerve.',
  lots: [
    ['Secret Billionaire Inheritance', 'S', 100, 50, ['BILLIONAIRE', 'FLEX'], 'Gold bar', 'A great-uncle you never met has left you everything.'],
    ['Deed to a Grand Prix Team', 'S', 92, 50, ['SPEED_DEMON', 'BILLIONAIRE'], 'Formula One', 'Two cars, a wind tunnel, and four hundred staff who now work for you.'],
    ['Lost Master Tape', 'A', 85, 50, ['NOSTALGIA', 'UK_LEGEND'], 'Reel-to-reel audio tape recording', 'The album that never came out. It is very, very good.'],
    ['Buried Roman Hoard', 'A', 84, 50, ['BILLIONAIRE', 'UK_LEGEND'], 'Hoxne Hoard', 'Fifteen thousand coins, found by a man looking for a lost hammer.'],
    ['Lifetime Front-Row Pass', 'B', 62, 50, ['FLEX', 'UK_LEGEND'], 'Wembley Stadium', 'Every final, every concert, every fight. For ever.'],
    ['Vintage Jukebox', 'B', 58, 50, ['NOSTALGIA', 'CHAOS'], 'Jukebox', 'Two hundred singles and a strong preference for one of them.'],
    ['Haunted Karaoke Machine', 'C', 20, 50, ['CHAOS', 'NOSTALGIA'], 'Karaoke', 'It plays one song, and it starts by itself at 3 a.m.'],
    ['Box of 400 Left Shoes', 'CURSED', 8, 50, ['BUDGET_KING', 'CHAOS'], 'Shoe', 'Four hundred. All left. All size eleven.'],
    ['A Literal Brick', 'CURSED', 5, 50, ['BUDGET_KING', 'MUSCLE'], 'Brick', 'It is a brick. We did warn you.'],
    ['Cursed Tax Audit', 'CURSED', 2, 50, ['CHAOS'], 'Filing cabinet', 'Seven years of receipts. They would like to see all of them.'],
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

const DUD_PALETTE = Object.freeze(['#6b6f74', '#3a3d41']);

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
    colorPalette: DUD_PALETTE,
    proceduralIconType: 'dud',
    wikiQuery: null,
    commentaryLine: d.line,
    dud: true,
  });
}

export function allItems() {
  return [...CATEGORIES.flatMap((c) => c.items), ...MYSTERY_CATEGORY.items];
}

const BY_ID = new Map(allItems().map((it) => [it.id, it]));

// Resolves an id from the wire, including penalty duds ("dud-<category>-<index>").
export function itemById(id) {
  if (BY_ID.has(id)) return BY_ID.get(id);
  const m = /^dud-(.+)-(\d+)$/.exec(String(id));
  return m ? makeDud(Number(m[2]), m[1]) : null;
}

export function categoryById(id) {
  return CATEGORIES.find((c) => c.id === id) || (id === MYSTERY_CATEGORY.id ? MYSTERY_CATEGORY : null);
}

// Hype is shown as 1-5 lamps.
export function hypeLamps(item) {
  return Math.max(1, Math.min(5, Math.ceil(item.baseAppeal / 20)));
}
