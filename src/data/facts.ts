/**
 * ──────────────────────────────────────────────────────────────────────────
 *  THE REVEAL CARDS: one entry per node, keyed by the node's id
 *  (its slugged title path, e.g. 'artificial-intelligence/machine-learning').
 *
 *  The card is set in big type, so every line is deliberately short.
 *  stat  one number worth stopping for. `value` is set in the display face (about seven characters at most);
 *        `label` says what it measures (about 36 characters).
 *  why   why the node matters (about 46 characters, two lines at most).
 *  next  what comes next (about 40 characters, two lines at most).
 *
 *  Every figure is a documented, dated fact worded to stay true as written. Re-check a figure before
 *  changing it, and avoid dashes as punctuation: use a full stop or a colon.
 * ──────────────────────────────────────────────────────────────────────────
 */
import type { NodeFact } from '@/engine/types';

const f = (value: string, label: string, why: string, next: string): NodeFact => ({ stat: { value, label }, why, next });

export const facts: Record<string, NodeFact> = {
  /* 1 ── ARTIFICIAL INTELLIGENCE ─────────────────────────────────────── */
  'artificial-intelligence': f('1956', 'the year the term was coined', 'Software that learns instead of following rules.', 'Agents that plan and act for you.'),
  'artificial-intelligence/machine-learning': f('1959', 'the year Arthur Samuel named it', 'Learning from examples beats hand-made rules.', 'More skill from far less data.'),
  'artificial-intelligence/machine-learning/supervised-learning': f('14M', 'labelled images in ImageNet', 'Labels turn a goal into something measurable.', 'Learning well from a few labels.'),
  'artificial-intelligence/machine-learning/reinforcement-learning': f('4:1', 'AlphaGo beat Lee Sedol, 2016', 'Rewards teach strategies no one coded.', 'Reward-trained robots and reasoners.'),
  'artificial-intelligence/machine-learning/neural-networks': f('60M', 'parameters in AlexNet, 2012', 'Stacked layers learn almost any pattern.', 'The same skill on far less energy.'),
  'artificial-intelligence/computer-vision': f('3.6%', 'ImageNet error in 2015, below humans', 'Machines that see can act in the world.', 'Understanding video and 3D, not stills.'),
  'artificial-intelligence/computer-vision/object-detection': f('45', 'frames a second for YOLO, 2016', 'Real-time detection lets cars and cameras react.', 'Finding anything you can describe.'),
  'artificial-intelligence/computer-vision/generative-imagery': f('2022', 'diffusion models reach laptops', 'A sentence can now become an image.', 'Video and 3D that stay consistent.'),
  'artificial-intelligence/computer-vision/medical-imaging': f('1,000+', 'FDA-cleared AI medical devices', 'Models flag what a doctor should check first.', 'Tools a clinician can audit.'),
  'artificial-intelligence/language-models': f('2017', 'the transformer is published', 'Language unlocks almost every task.', 'Assistants that remember and use tools.'),
  'artificial-intelligence/language-models/large-language-models': f('175B', 'parameters in GPT-3, 2020', 'Predicting words teaches facts and reasoning.', 'Smaller models that run on phones.'),
  'artificial-intelligence/language-models/speech-voice': f('680K', 'hours of audio behind Whisper', 'Voice works when hands and eyes are busy.', 'Live translation in your own voice.'),
  'artificial-intelligence/language-models/machine-translation': f('7,000', 'languages spoken worldwide', 'One document can reach everyone.', 'Speech translation for small languages.'),
  'artificial-intelligence/ai-ethics': f('2024', 'the EU AI Act becomes law', 'Systems that judge people must stay fair.', 'Audits you can test and certify.'),
  'artificial-intelligence/ai-ethics/bias-fairness': f('34.7%', 'face-analysis error, Gender Shades', 'Models copy the bias in their data.', 'Fairness tests built into training.'),
  'artificial-intelligence/ai-ethics/explainability': f('2018', 'GDPR covers automated decisions', 'You can only challenge reasons you can see.', 'Tools that trace answers to causes.'),
  'artificial-intelligence/ai-ethics/ai-governance': f('28', 'countries signed Bletchley, 2023', 'Rules work best when shaped early.', 'Shared tests across borders.'),

  /* 2 ── ROBOTICS ─────────────────────────────────────────────────────── */
  robotics: f('4M+', 'industrial robots at work', 'Robots sense, decide and act in the world.', 'Machines that learn from a demo.'),
  'robotics/autonomous-machines': f('132 mi', 'driverless desert run, 2005', 'Machines take the dull, dangerous jobs.', 'Fleets that coordinate with cities.'),
  'robotics/autonomous-machines/self-driving-vehicles': f('94%', 'of crashes trace to the driver (NHTSA)', 'A driver that never tires could save lives.', 'Driverless taxis, city by city.'),
  'robotics/autonomous-machines/drones': f('72', 'flights by Ingenuity on Mars', 'Flying robots reach where roads cannot.', 'Shared air lanes above cities.'),
  'robotics/autonomous-machines/delivery-bots': f('4 mph', 'top speed of a Starship robot', 'The last mile is the costliest mile.', 'Bots that ride lifts and cross streets.'),
  'robotics/humanoids': f('1973', 'WABOT-1, the first humanoid', 'Our world is built for human bodies.', 'Pilots in warehouses and factories.'),
  'robotics/humanoids/bipedal-locomotion': f('5K', 'run by robot Cassie in 2021', 'Walking is a controlled fall.', 'Gaits learned in simulation.'),
  'robotics/humanoids/dexterous-hands': f('27', 'bones in a human hand', 'Touch matters as much as position.', 'Fingertips that feel slip.'),
  'robotics/humanoids/social-robots': f('1.6B', 'people over 65 by 2050 (UN)', 'Care needs are outgrowing carers.', 'Companions that notice changes.'),
  'robotics/industrial-automation': f('1961', 'Unimate, the first factory robot', 'Repeating perfectly is where robots win.', 'Cells that retool in hours.'),
  'robotics/industrial-automation/collaborative-robots': f('2008', 'first collaborative arm, UR5', 'No cage means small shops can automate.', 'Arms you teach by hand.'),
  'robotics/industrial-automation/smart-factories': f('2011', 'the term Industry 4.0 appears', 'A connected line catches faults early.', 'Test changes on a digital twin.'),
  'robotics/industrial-automation/warehouse-systems': f('1M', 'robots across Amazon by 2025', 'Orders now need real-time routing.', 'Fleets that pick any item.'),
  'robotics/swarm-robotics': f('1,024', 'Kilobots forming shapes, 2014', 'Swarms survive losing members.', 'One intent steering many robots.'),
  'robotics/swarm-robotics/collective-behaviour': f('3', 'rules give Boids a flock’s motion', 'No leader needed, only local rules.', 'Steer a group by changing rules.'),
  'robotics/swarm-robotics/modular-robots': f('1988', 'CEBOT, reconfigurable robot cells', 'One body rebuilds for many jobs.', 'Modules that dock and swap alone.'),
  'robotics/swarm-robotics/search-rescue': f('72 h', 'the window to find survivors', 'Small robots go where people cannot.', 'Swarms that map collapsed buildings.'),

  /* 3 ── SUSTAINABILITY ───────────────────────────────────────────────── */
  sustainability: f('1.5°C', 'the Paris Agreement warming goal', 'Cleaner energy changes everything downstream.', 'Waste from one process feeds another.'),
  'sustainability/clean-energy': f('30%', 'of world power was renewable, 2023', 'Power is the fastest sector to clean.', 'Storage and grids for wind and sun.'),
  'sustainability/clean-energy/solar': f('89%', 'drop in solar cost, 2010 to 2022', 'Sunlight is now the cheapest power.', 'Panels layered on silicon.'),
  'sustainability/clean-energy/wind-tidal': f('107 m', 'blade on GE’s Haliade-X turbine', 'Offshore wind and tide are steady.', 'Floating turbines in deep water.'),
  'sustainability/clean-energy/fusion': f('3.15 MJ', 'out from 2.05 MJ in, 2022', 'Seawater fuel and low-carbon power.', 'Steady plants with net power.'),
  'sustainability/smart-cities': f('68%', 'of people in cities by 2050', 'Small savings per street add up.', 'Open data to test ideas first.'),
  'sustainability/smart-cities/smart-grids': f('50M', 'people lost power in the 2003 blackout', 'Power now flows both ways.', 'Batteries that smooth the peaks.'),
  'sustainability/smart-cities/green-transport': f('20%', 'of new cars were electric, 2024', 'Electric drive wastes far less energy.', 'Charging that follows the sun.'),
  'sustainability/smart-cities/urban-farming': f('95%', 'less water used in some vertical farms', 'Food grown where it is eaten.', 'Farms on waste heat and rainwater.'),
  'sustainability/climate-tech': f('420+', 'ppm of CO₂ today, up from 280', 'Cut emissions and pull carbon out.', 'Satellites that track emitters live.'),
  'sustainability/climate-tech/carbon-capture': f('36,000', 'tonnes a year, Climeworks Mammoth', 'Some emissions cannot be avoided.', 'Cheaper removal, stored in rock.'),
  'sustainability/climate-tech/climate-modelling': f('2021', 'Nobel Prize for climate models', 'Test decisions on a copy of Earth.', 'Local forecasts of floods and heat.'),
  'sustainability/climate-tech/precision-agriculture': f('70%', 'of freshwater goes to farming', 'Treat each plant by need.', 'Robots that weed plant by plant.'),
  'sustainability/green-computing': f('1.5%', 'of world power to data centres', 'Compute grows, so efficiency matters.', 'Jobs timed to clean power.'),
  'sustainability/green-computing/efficient-silicon': f('1.6 yr', 'doubling time, Koomey’s law', 'The cheapest watt is the unused one.', 'Chips tuned for one job.'),
  'sustainability/green-computing/carbon-aware-software': f('10×+', 'grid carbon gap, clean to dirty', 'Same code, very different emissions.', 'Jobs that chase surplus sun.'),
  'sustainability/green-computing/e-waste-reuse': f('62 Mt', 'of e-waste in 2022, 22% recycled', 'Making a device outweighs charging it.', 'Repair and take-back by design.'),

  /* 4 ── INNOVATION ───────────────────────────────────────────────────── */
  innovation: f('1965', 'Moore predicts chip doubling', 'Old ideas meet new needs.', 'Shorter loops from lab to product.'),
  'innovation/emerging-tech': f('2007', 'the first iPhone launches', 'Today’s toy is tomorrow’s standard.', 'Cheap ways to test early signals.'),
  'innovation/emerging-tech/spatial-computing': f('2024', 'Apple launches Vision Pro', 'Information as an object in the room.', 'Lighter glasses anchored to places.'),
  'innovation/emerging-tech/brain-computer-interfaces': f('2004', 'first cursor moved by thought', 'Restores voice and movement.', 'Implants that last for years.'),
  'innovation/emerging-tech/digital-twins': f('2002', 'Grieves introduces digital twins', 'Test and repair on the copy first.', 'Twins of cities and bodies.'),
  'innovation/rapid-prototyping': f('200+', 'wing shapes the Wrights tested', 'Cheap tries teach more than plans.', 'Sketch to test in one afternoon.'),
  'innovation/rapid-prototyping/design-thinking': f('5', 'stages from empathise to test', 'Start from what people need.', 'Observation mixed with real data.'),
  'innovation/rapid-prototyping/3d-fabrication': f('1983', 'the first 3D-printed part', 'No tooling, so one-offs cost little.', 'Finished metal parts, printed.'),
  'innovation/rapid-prototyping/open-source-hardware': f('2005', 'Arduino opens its designs', 'Anyone can copy, fix and learn.', 'Open chips like RISC-V.'),
  'innovation/new-materials': f('2.2M', 'new crystals predicted by GNoME', 'A better material lifts everything.', 'AI proposes, robots test.'),
  'innovation/new-materials/graphene': f('200×', 'steel strength, one atom thick', 'One carbon layer conducts and filters.', 'Graphene made cheaply at scale.'),
  'innovation/new-materials/neuromorphic-chips': f('20 W', 'a human brain’s power budget', 'Brains need only a few watts.', 'Sensors that sleep until events.'),
  'innovation/new-materials/flexible-electronics': f('2019', 'Galaxy Fold reaches stores', 'Circuits move onto skin and cloth.', 'Health patches and rollable screens.'),
  'innovation/moonshots': f('8 yrs', 'from the 1961 pledge to the Moon', 'Impossible goals force new tools.', 'Public missions plus private bets.'),
  'innovation/moonshots/space-technology': f('20×', 'cheaper launches, Shuttle to Falcon 9', 'Orbit becomes everyday infrastructure.', 'Rockets that fully reuse.'),
  'innovation/moonshots/longevity-science': f('+25', 'years of life since 1950', 'Slowing ageing may delay many diseases.', 'Trials that measure biological age.'),
  'innovation/moonshots/hyperloop-beyond': f('760 mph', 'the 2013 Hyperloop proposal', 'Low-pressure tubes trade drag for engineering.', 'Lessons for rail and maglev.'),

  /* 5 ── FUTURE SKILLS ────────────────────────────────────────────────── */
  'future-skills': f('39%', 'of core skills change by 2030', 'Learning matters more than any one skill.', 'Short credentials that travel with you.'),
  'future-skills/digital-literacy': f('5.5B', 'people online in 2024 (ITU)', 'Almost every service sits behind a screen.', 'Judging AI output and spotting scams.'),
  'future-skills/digital-literacy/data-literacy': f('1854', 'Snow maps cholera to one pump', 'Questioning numbers protects you.', 'Charts taught alongside reading.'),
  'future-skills/digital-literacy/cybersecurity-hygiene': f('99.9%', 'stopped by two-step sign-in (Microsoft)', 'Most attacks target people, not code.', 'Passkeys instead of passwords.'),
  'future-skills/digital-literacy/media-discernment': f('6×', 'faster: false stories vs true (MIT)', 'Fakes are cheap, so judge the source.', 'Content credentials in browsers.'),
  'future-skills/computational-thinking': f('2006', 'Wing calls it a skill for everyone', 'Break problems into steps and rules.', 'Taught early, through play.'),
  'future-skills/computational-thinking/algorithms': f('300 BC', 'Euclid’s algorithm, still in use', 'A good algorithm saves centuries.', 'Learned methods with guarantees.'),
  'future-skills/computational-thinking/systems-thinking': f('1972', 'Limits to Growth modelled feedback', 'Fix one part, harm shifts elsewhere.', 'Simulations that show the loops.'),
  'future-skills/computational-thinking/debugging-mindset': f('1947', 'the moth in Harvard’s computer', 'Calm testing beats guessing.', 'AI that reads logs and tests fixes.'),
  'future-skills/human-skills': f('#1', 'analytical thinking, WEF 2025', 'Judgement and empathy stay in demand.', 'Practice with feedback, not luck.'),
  'future-skills/human-skills/creativity': f('1,093', 'US patents held by Edison', 'New ideas combine old ones.', 'AI sketchpads, human choice.'),
  'future-skills/human-skills/collaboration': f('1,000+', 'developers per Linux release', 'Hard problems cross many fields.', 'Teams that write decisions down.'),
  'future-skills/human-skills/adaptability': f('170M', 'new roles by 2030 (WEF)', 'Jobs change faster than training.', 'Skills that transfer between jobs.'),
  'future-skills/lifelong-learning': f('100M+', 'people signed up to Coursera', 'A degree is only the start.', 'Credentials that update as you learn.'),
  'future-skills/lifelong-learning/microlearning': f('1885', 'Ebbinghaus’s forgetting curve', 'Short, repeated practice sticks.', 'Prompts timed to what you forget.'),
  'future-skills/lifelong-learning/mentorship': f('2 sigma', 'Bloom’s tutoring gain, 1984', 'Learn from those who erred first.', 'AI practice, human guidance.'),
  'future-skills/lifelong-learning/project-based-learning': f('1918', 'Kilpatrick’s Project Method', 'Building forces you to use what you know.', 'Portfolios of real work.'),

  /* 6 ── QUANTUM ──────────────────────────────────────────────────────── */
  quantum: f('1900', 'Planck introduces the quantum', 'Small scales run on different rules.', 'Useful machines for specific jobs.'),
  'quantum/quantum-computing': f('53', 'qubits in Google’s Sycamore', 'Some problems stop growing exponentially.', 'Error-corrected qubits for chemistry.'),
  'quantum/quantum-computing/qubits': f('300', 'qubits: more states than atoms', 'One register holds many possibilities.', 'Loops, ions, photons and spins.'),
  'quantum/quantum-computing/quantum-algorithms': f('1994', 'Shor factors numbers quickly', 'A few algorithms justify the hardware.', 'Routines for early machines.'),
  'quantum/quantum-computing/error-correction': f('105', 'qubits on Google’s Willow', 'Hundreds of qubits guard one.', 'Fewer qubits per reliable one.'),
  'quantum/quantum-communication': f('1,200 km', 'entangled photons by Micius', 'Single particles cannot be copied unseen.', 'Links from city to country.'),
  'quantum/quantum-communication/key-distribution': f('1984', 'BB84 quantum keys published', 'Eavesdropping changes the state.', 'Cheaper, smaller key systems.'),
  'quantum/quantum-communication/quantum-internet': f('3', 'nodes in QuTech’s 2021 network', 'Linked devices share entanglement.', 'Repeaters for long distance.'),
  'quantum/quantum-communication/entanglement': f('2022', 'Nobel Prize for entanglement', 'Particles share one joint state.', 'More, longer, farther.'),
  'quantum/quantum-sensing': f('1/10,000', 'of a proton: LIGO’s precision', 'Beat noise using quantum physics.', 'Navigation without GPS.'),
  'quantum/quantum-sensing/atomic-clocks': f('15B yrs', 'to drift one second, 2014', 'Time runs phones and banks.', 'Optical clocks that fly.'),
  'quantum/quantum-sensing/quantum-imaging': f('1', 'photon per pixel can build an image', 'See through fog with little light.', 'Gentler imaging inside tissue.'),
  'quantum/quantum-sensing/magnetometry': f('100 fT', 'the brain’s magnetic field', 'Tiny fields reveal brain and heart.', 'Room-temperature diamond sensors.'),
  'quantum/post-quantum-security': f('2024', 'NIST’s first post-quantum standards', 'Today’s encryption would fall.', 'Hybrid schemes while standards settle.'),
  'quantum/post-quantum-security/lattice-cryptography': f('ML-KEM', 'NIST’s lattice standard, FIPS 203', 'Hard for every known computer.', 'Small keys for phones and cards.'),
  'quantum/post-quantum-security/migration-planning': f('2035', 'NIST draft ends old algorithms', 'Swapping crypto takes years.', 'Software that changes algorithms live.'),
  'quantum/post-quantum-security/harvest-now-decrypt-later': f('Decades', 'some records must stay secret', 'Stolen data can wait for quantum.', 'Protect long-lived secrets first.'),
};
