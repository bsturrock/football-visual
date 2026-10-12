// Placeholder surnames for players the sim hasn't named yet.
const SURNAMES = [
  'Adams', 'Baker', 'Bell', 'Brooks', 'Carter', 'Coleman', 'Collins', 'Davis', 'Dixon', 'Ellis',
  'Foster', 'Graham', 'Grant', 'Hayes', 'Henderson', 'Hill', 'Holmes', 'Hughes', 'Jackson', 'James',
  'Jenkins', 'Johnson', 'Jordan', 'Kelly', 'King', 'Lewis', 'Marshall', 'Martin', 'Mason', 'Mills',
  'Mitchell', 'Moore', 'Morgan', 'Murphy', 'Nelson', 'Owens', 'Parker', 'Perry', 'Powell', 'Price',
  'Reed', 'Reynolds', 'Richards', 'Robinson', 'Ross', 'Sanders', 'Scott', 'Simmons', 'Stewart', 'Sullivan',
  'Taylor', 'Thomas', 'Thompson', 'Turner', 'Walker', 'Wallace', 'Ward', 'Warren', 'Washington', 'Watson',
  'West', 'White', 'Williams', 'Wilson', 'Wright', 'Young',
];

/** Deterministic placeholder surname from a PRNG. */
export function placeholderName(rand) {
  return SURNAMES[(rand() * SURNAMES.length) | 0];
}
