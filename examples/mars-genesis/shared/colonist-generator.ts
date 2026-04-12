import type { Colonist, Department } from './state.js';
import { SeededRng } from './rng.js';

const FIRST_NAMES = [
  'Aria', 'Dietrich', 'Yuki', 'Marcus', 'Elena', 'Kwame', 'Sofia', 'Jin',
  'Amara', 'Liam', 'Priya', 'Omar', 'Mei', 'Carlos', 'Ingrid', 'Tariq',
  'Nadia', 'Henrik', 'Aisha', 'Pavel', 'Luna', 'Ravi', 'Zara', 'Felix',
  'Anya', 'Diego', 'Kira', 'Hassan', 'Signe', 'Jamal', 'Mila', 'Chen',
  'Fatima', 'Anders', 'Keiko', 'David', 'Olga', 'Kofi', 'Leila', 'Sven',
  'Rosa', 'Idris', 'Hana', 'Bruno', 'Daria', 'Emeka', 'Yara', 'Tomas',
  'Nia', 'Viktor',
];

const LAST_NAMES = [
  'Chen', 'Voss', 'Tanaka', 'Webb', 'Kowalski', 'Okafor', 'Petrov', 'Kim',
  'Santos', 'Johansson', 'Patel', 'Al-Rashid', 'Nakamura', 'Fernandez', 'Berg',
  'Ibrahim', 'Volkov', 'Singh', 'Torres', 'Andersen', 'Müller', 'Zhang',
  'Osei', 'Larsson', 'Ahmad', 'Costa', 'Ivanova', 'Park', 'Eriksson', 'Diallo',
  'Sato', 'Rivera', 'Lindqvist', 'Mensah', 'Kato', 'Morales', 'Holm', 'Yusuf',
  'Takahashi', 'Reyes', 'Nkomo', 'Li', 'Herrera', 'Bakker', 'Ito', 'Mendez',
  'Dahl', 'Owusu', 'Yamamoto', 'Cruz',
];

const SPECIALIZATIONS: Record<Department, string[]> = {
  medical: ['General Medicine', 'Radiation Medicine', 'Surgery', 'Psychiatry', 'Emergency Medicine'],
  engineering: ['Structural', 'Life Support', 'Power Systems', 'Communications', 'Robotics'],
  agriculture: ['Hydroponics', 'Soil Science', 'Botany', 'Nutrition', 'Water Systems'],
  science: ['Geology', 'Atmospheric Science', 'Biology', 'Chemistry', 'Astrophysics'],
  administration: ['Operations', 'Logistics', 'HR', 'Communications', 'Planning'],
  psychology: ['Clinical Psychology', 'Social Psychology', 'Occupational Therapy'],
  governance: ['Policy', 'Law', 'Diplomacy'],
};

const DEPARTMENT_DISTRIBUTION: Department[] = [
  'engineering', 'engineering', 'engineering', 'engineering',
  'medical', 'medical', 'medical',
  'agriculture', 'agriculture', 'agriculture',
  'science', 'science', 'science',
  'administration', 'administration',
  'psychology',
];

export interface KeyPersonnel {
  name: string;
  department: Department;
  role: string;
  specialization: string;
  age: number;
  featured: boolean;
}

export function generateInitialPopulation(seed: number, startYear: number, keyPersonnel: KeyPersonnel[]): Colonist[] {
  const rng = new SeededRng(seed);
  const colonists: Colonist[] = [];
  const usedNames = new Set<string>();

  for (const kp of keyPersonnel) {
    usedNames.add(kp.name);
    colonists.push(createColonist(kp.name, startYear - kp.age, kp.department, kp.role, kp.specialization, false, kp.featured));
  }

  const remaining = 100 - keyPersonnel.length;
  for (let i = 0; i < remaining; i++) {
    let name: string;
    do {
      name = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
    } while (usedNames.has(name));
    usedNames.add(name);

    const dept = rng.pick(DEPARTMENT_DISTRIBUTION);
    const spec = rng.pick(SPECIALIZATIONS[dept]);
    const age = rng.int(25, 55);
    const rank = age > 40 ? (rng.chance(0.3) ? 'lead' : 'senior') : (rng.chance(0.2) ? 'senior' : 'junior');

    const c = createColonist(
      name, startYear - age, dept,
      `${rank.charAt(0).toUpperCase() + rank.slice(1)} ${spec} Specialist`,
      spec, false, false,
    );
    c.career.rank = rank as 'junior' | 'senior' | 'lead';
    c.career.yearsExperience = rng.int(2, age - 22);
    colonists.push(c);
  }

  return colonists;
}

function createColonist(
  name: string, birthYear: number, department: Department,
  role: string, specialization: string, marsborn: boolean, featured: boolean,
): Colonist {
  return {
    core: { id: `col-${name.toLowerCase().replace(/\s+/g, '-')}`, name, birthYear, marsborn, department, role },
    health: { alive: true, boneDensityPct: marsborn ? 88 : 100, cumulativeRadiationMsv: 0, psychScore: 0.8, conditions: [] },
    career: { specialization, yearsExperience: 0, rank: 'senior', achievements: [] },
    social: { childrenIds: [], friendIds: [], earthContacts: marsborn ? 0 : 5 },
    narrative: { lifeEvents: [], featured },
  };
}
