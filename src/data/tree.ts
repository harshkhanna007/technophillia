/**
 * ──────────────────────────────────────────────────────────────────────────
 *  THE TREE — everything the engine grows comes from this file.
 *
 *  • Add / rename / reorder categories, children and grandchildren freely.
 *    Nesting can go as deep as you like; the layout engine re-partitions the
 *    territory automatically so branches never collide.
 *  • `style` picks the procedural personality of a branch
 *    ('neural' | 'mechanical' | 'organic' | 'chaotic' | 'network' | 'quantum').
 *  • The SIXTH category (the last entry) is a placeholder: change its title,
 *    style, palette and children below and nothing else needs touching.
 * ──────────────────────────────────────────────────────────────────────────
 */
import type { CategoryData, ExperienceMeta } from '@/engine/types';

export const meta: ExperienceMeta = {
  wordmark: 'TECHNOPHILIA',
  hint: 'select a node to grow the tree',
};

export const categories: CategoryData[] = [
  /* 1 ─────────────────────────────────────────────────────────────── */
  {
    title: 'ARTIFICIAL INTELLIGENCE',
    style: 'neural',
    palette: { a: '#1fd9ff', b: '#4b7dff', accent: '#bff6ff' },
    description: 'Machines that learn, perceive and reason — the engine of the next decade.',
    children: [
      {
        title: 'MACHINE LEARNING',
        description: 'Systems that improve from experience instead of explicit rules.',
        children: [
          { title: 'SUPERVISED LEARNING', description: 'Learning a mapping from labelled examples.' },
          { title: 'REINFORCEMENT LEARNING', description: 'Agents that learn by trial, reward and consequence.' },
          { title: 'NEURAL NETWORKS', description: 'Layered, differentiable function approximators inspired by the brain.' },
        ],
      },
      {
        title: 'COMPUTER VISION',
        description: 'Teaching machines to see, segment and understand the visual world.',
        children: [
          { title: 'OBJECT DETECTION', description: 'Finding and classifying what is in a frame, in real time.' },
          { title: 'GENERATIVE IMAGERY', description: 'Diffusion and transformer models that synthesise pictures.' },
          { title: 'MEDICAL IMAGING', description: 'Spotting disease earlier than the human eye can.' },
        ],
      },
      {
        title: 'LANGUAGE MODELS',
        description: 'Software that reads, writes and translates human language.',
        children: [
          { title: 'LARGE LANGUAGE MODELS', description: 'Transformers trained on a significant slice of human text.' },
          { title: 'SPEECH & VOICE', description: 'Recognition and synthesis that sounds unmistakably human.' },
          { title: 'MACHINE TRANSLATION', description: 'Breaking language barriers at planetary scale.' },
        ],
      },
      {
        title: 'AI ETHICS',
        description: 'Building powerful systems that remain fair, safe and accountable.',
        children: [
          { title: 'BIAS & FAIRNESS', description: 'Auditing data and models for unequal outcomes.' },
          { title: 'EXPLAINABILITY', description: 'Making model decisions legible to the people they affect.' },
          { title: 'AI GOVERNANCE', description: 'Policy, standards and oversight for high-stakes automation.' },
        ],
      },
    ],
  },
  /* 2 ─────────────────────────────────────────────────────────────── */
  {
    title: 'ROBOTICS',
    style: 'mechanical',
    palette: { a: '#3d8bff', b: '#7cc4ff', accent: '#ffffff' },
    description: 'Intelligence given a body — sensing, deciding and acting in the physical world.',
    children: [
      {
        title: 'AUTONOMOUS MACHINES',
        description: 'Vehicles and craft that navigate without a human at the controls.',
        children: [
          { title: 'SELF-DRIVING VEHICLES', description: 'Perception, planning and control on public roads.' },
          { title: 'DRONES', description: 'Aerial robots for mapping, rescue and delivery.' },
          { title: 'DELIVERY BOTS', description: 'The last mile, handled by small wheeled robots.' },
        ],
      },
      {
        title: 'HUMANOIDS',
        description: 'General-purpose machines built to work in spaces made for people.',
        children: [
          { title: 'BIPEDAL LOCOMOTION', description: 'Balance and gait on two legs.' },
          { title: 'DEXTEROUS HANDS', description: 'Fine manipulation with tactile feedback.' },
          { title: 'SOCIAL ROBOTS', description: 'Companions designed for conversation and care.' },
        ],
      },
      {
        title: 'INDUSTRIAL AUTOMATION',
        description: 'Precision, repeatability and scale on the factory floor.',
        children: [
          { title: 'COLLABORATIVE ROBOTS', description: 'Cobots that safely share a workspace with people.' },
          { title: 'SMART FACTORIES', description: 'Connected production lines that adapt in real time.' },
          { title: 'WAREHOUSE SYSTEMS', description: 'Fleets that pick, pack and route autonomously.' },
        ],
      },
      {
        title: 'SWARM ROBOTICS',
        description: 'Many simple machines producing intelligent collective behaviour.',
        children: [
          { title: 'COLLECTIVE BEHAVIOUR', description: 'Emergent order from local rules.' },
          { title: 'MODULAR ROBOTS', description: 'Units that reassemble themselves for the task at hand.' },
          { title: 'SEARCH & RESCUE', description: 'Swarms that map collapsed structures.' },
        ],
      },
    ],
  },
  /* 3 ─────────────────────────────────────────────────────────────── */
  {
    title: 'SUSTAINABILITY',
    style: 'organic',
    palette: { a: '#25f2c4', b: '#2aa9ff', accent: '#d8fff0' },
    description: 'Technology that heals rather than consumes — design with the planet inside the loop.',
    children: [
      {
        title: 'CLEAN ENERGY',
        description: 'Power generation without the carbon bill.',
        children: [
          { title: 'SOLAR', description: 'Photovoltaics getting cheaper every year.' },
          { title: 'WIND & TIDAL', description: 'Harvesting moving air and water.' },
          { title: 'FUSION', description: 'Bottling the physics of a star.' },
        ],
      },
      {
        title: 'SMART CITIES',
        description: 'Urban systems that sense, learn and use less.',
        children: [
          { title: 'SMART GRIDS', description: 'Electricity networks that balance themselves.' },
          { title: 'GREEN TRANSPORT', description: 'Electrified, shared and multimodal movement.' },
          { title: 'URBAN FARMING', description: 'Food grown where it is eaten.' },
        ],
      },
      {
        title: 'CLIMATE TECH',
        description: 'Measuring, modelling and reversing environmental damage.',
        children: [
          { title: 'CARBON CAPTURE', description: 'Pulling CO₂ back out of the air.' },
          { title: 'CLIMATE MODELLING', description: 'Simulating the planet to guide decisions.' },
          { title: 'PRECISION AGRICULTURE', description: 'Water, fertiliser and pesticide down to the plant.' },
        ],
      },
      {
        title: 'GREEN COMPUTING',
        description: 'Making the digital world lighter on the physical one.',
        children: [
          { title: 'EFFICIENT SILICON', description: 'More computation per joule.' },
          { title: 'CARBON-AWARE SOFTWARE', description: 'Workloads that follow clean energy.' },
          { title: 'E-WASTE & REUSE', description: 'Designing devices to live many lives.' },
        ],
      },
    ],
  },
  /* 4 ─────────────────────────────────────────────────────────────── */
  {
    title: 'INNOVATION',
    style: 'chaotic',
    palette: { a: '#c14bff', b: '#ff4fd8', accent: '#ffe3fb' },
    description: 'The restless edge — where unreasonable ideas become working prototypes.',
    children: [
      {
        title: 'EMERGING TECH',
        description: 'Capabilities that barely existed five years ago.',
        children: [
          { title: 'SPATIAL COMPUTING', description: 'Interfaces that live in the room with you.' },
          { title: 'BRAIN–COMPUTER INTERFACES', description: 'Thought as an input device.' },
          { title: 'DIGITAL TWINS', description: 'Living virtual replicas of physical systems.' },
        ],
      },
      {
        title: 'RAPID PROTOTYPING',
        description: 'From idea to artefact before the idea cools.',
        children: [
          { title: 'DESIGN THINKING', description: 'Empathise, define, ideate, test.' },
          { title: '3D FABRICATION', description: 'Printing, milling and moulding on demand.' },
          { title: 'OPEN SOURCE HARDWARE', description: 'Shared schematics, faster iteration.' },
        ],
      },
      {
        title: 'NEW MATERIALS',
        description: 'Matter engineered for properties nature never offered.',
        children: [
          { title: 'GRAPHENE', description: 'One atom thick, stronger than steel.' },
          { title: 'NEUROMORPHIC CHIPS', description: 'Silicon that computes like neurons.' },
          { title: 'FLEXIBLE ELECTRONICS', description: 'Circuits that bend, stretch and wear.' },
        ],
      },
      {
        title: 'MOONSHOTS',
        description: 'Ambitions big enough to be called impossible.',
        children: [
          { title: 'SPACE TECHNOLOGY', description: 'Cheaper access to orbit and beyond.' },
          { title: 'LONGEVITY SCIENCE', description: 'Extending healthy human life.' },
          { title: 'HYPERLOOP & BEYOND', description: 'Rethinking how far an hour can take you.' },
        ],
      },
    ],
  },
  /* 5 ─────────────────────────────────────────────────────────────── */
  {
    title: 'FUTURE SKILLS',
    style: 'network',
    palette: { a: '#8f7bff', b: '#35d6ff', accent: '#e6e0ff' },
    description: 'What to learn so the next wave works for you, not around you.',
    children: [
      {
        title: 'DIGITAL LITERACY',
        description: 'Fluency in the medium everything now runs on.',
        children: [
          { title: 'DATA LITERACY', description: 'Reading, questioning and communicating with data.' },
          { title: 'CYBERSECURITY HYGIENE', description: 'Habits that keep people and systems safe.' },
          { title: 'MEDIA DISCERNMENT', description: 'Separating signal from synthetic noise.' },
        ],
      },
      {
        title: 'COMPUTATIONAL THINKING',
        description: 'Breaking big problems into steps a machine — or a team — can follow.',
        children: [
          { title: 'ALGORITHMS', description: 'Recipes for solving problems efficiently.' },
          { title: 'SYSTEMS THINKING', description: 'Seeing the feedback loops, not just the parts.' },
          { title: 'DEBUGGING MINDSET', description: 'Calm, methodical curiosity about what went wrong.' },
        ],
      },
      {
        title: 'HUMAN SKILLS',
        description: 'The things that stay valuable however capable the machines become.',
        children: [
          { title: 'CREATIVITY', description: 'Making something that was not there before.' },
          { title: 'COLLABORATION', description: 'Doing together what no one can do alone.' },
          { title: 'ADAPTABILITY', description: 'Staying useful as the ground keeps moving.' },
        ],
      },
      {
        title: 'LIFELONG LEARNING',
        description: 'Treating education as a habit, not a phase.',
        children: [
          { title: 'MICROLEARNING', description: 'Small, frequent, compounding.' },
          { title: 'MENTORSHIP', description: 'Learning faster from people a few steps ahead.' },
          { title: 'PROJECT-BASED LEARNING', description: 'Understanding by building real things.' },
        ],
      },
    ],
  },
  /* 6 ── CONFIGURABLE SIXTH CATEGORY (placeholder: QUANTUM) ───────── */
  {
    title: 'QUANTUM',
    style: 'quantum',
    palette: { a: '#8ff3ff', b: '#a07bff', accent: '#ff7ae6' },
    description: 'Computation and communication at the scale where physics stops being intuitive.',
    children: [
      {
        title: 'QUANTUM COMPUTING',
        description: 'Processors that exploit superposition and entanglement.',
        children: [
          { title: 'QUBITS', description: 'Two-level systems that can hold a blend of states.' },
          { title: 'QUANTUM ALGORITHMS', description: 'Shor, Grover and the problems they crack.' },
          { title: 'ERROR CORRECTION', description: 'Keeping fragile states alive long enough to compute.' },
        ],
      },
      {
        title: 'QUANTUM COMMUNICATION',
        description: 'Messages whose security is guaranteed by physics.',
        children: [
          { title: 'KEY DISTRIBUTION', description: 'Eavesdropping that cannot go unnoticed.' },
          { title: 'QUANTUM INTERNET', description: 'Networks that share entanglement.' },
          { title: 'ENTANGLEMENT', description: 'Correlation without a classical explanation.' },
        ],
      },
      {
        title: 'QUANTUM SENSING',
        description: 'Measurements precise enough to see the invisible.',
        children: [
          { title: 'ATOMIC CLOCKS', description: 'Timekeeping to one second in billions of years.' },
          { title: 'QUANTUM IMAGING', description: 'Seeing through fog, walls and noise.' },
          { title: 'MAGNETOMETRY', description: 'Mapping fields from the brain to the crust.' },
        ],
      },
      {
        title: 'POST-QUANTUM SECURITY',
        description: 'Cryptography built to survive the machines it anticipates.',
        children: [
          { title: 'LATTICE CRYPTOGRAPHY', description: 'Hard geometry problems as a shield.' },
          { title: 'MIGRATION PLANNING', description: 'Replacing the locks before the keys are picked.' },
          { title: 'HARVEST NOW, DECRYPT LATER', description: 'Why today’s secrets already need tomorrow’s protection.' },
        ],
      },
    ],
  },
];
