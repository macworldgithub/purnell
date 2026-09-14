export interface PentanaCustomer {
  cli: string;
  name: string;
  vehicle: string;
  rego: string;
  openRo: string | null;
  partsStatus: string | null;
  nextAppointment: string | null;
  notes?: string;
}

export interface AppointmentSlot {
  date: string;
  time: string;
  advisor: string;
  available: boolean;
}

export interface StaffMember {
  name: string;
  role: string;
  status: 'Available' | 'On another call' | 'Away from desk' | 'Offline';
  department: 'Aftersales' | 'Sales' | 'Service' | 'Parts' | 'Accounts';
}

export interface HandoffRecord {
  timestamp: string;
  intentLabel: string;
  callerName: string;
  callbackNumber: string;
  vehicle: string;
  reason: string;
  urgency: 'Low' | 'Medium' | 'High' | 'Safety';
  destination: string;
  transferAttempted: 'Yes' | 'No' | 'N/A';
  transferOutcome: 'Completed' | 'Failed' | 'Callback created';
  sourceContext: string;
  promisedCallbackWindow: string;
}

export const MOCK_PENTANA_CUSTOMERS: PentanaCustomer[] = [
  {
    cli: '0412345678',
    name: 'Sarah Thornton',
    vehicle: '2023 Range Rover Sport',
    rego: 'XYZ-001',
    openRo: 'RO-4421 (brake service)',
    partsStatus: 'Part #BR-994 — ARRIVED',
    nextAppointment: null,
    notes: 'Parts arrived, ready for fitment booking',
  },
  {
    cli: '0421987654',
    name: 'David Nguyen',
    vehicle: '2024 Defender 110',
    rego: 'DEF-220',
    openRo: null,
    partsStatus: null,
    nextAppointment: '15 Sep @ 9:00 AM',
    notes: 'Confirmed test drive / service drop-off',
  },
  {
    cli: '0435111222',
    name: 'Margaret Ellis',
    vehicle: '2022 Jaguar F-Pace',
    rego: 'JAG-882',
    openRo: 'RO-4389 (recall campaign)',
    partsStatus: 'Parts ordered — NOT YET ARRIVED',
    nextAppointment: null,
    notes: 'Recall campaign pending parts arrival',
  },
  {
    cli: '0448333444',
    name: 'Tom Purnell',
    vehicle: '2025 INEOS Grenadier',
    rego: 'INE-007',
    openRo: 'RO-4502 (annual service)',
    partsStatus: '—',
    nextAppointment: null,
    notes: 'In workshop, estimated completion 3:30 PM',
  },
];

export const MOCK_APPOINTMENT_SLOTS: AppointmentSlot[] = [
  {
    date: 'Tuesday 16 Sep',
    time: '8:00 AM',
    advisor: 'Jacob',
    available: true,
  },
  {
    date: 'Tuesday 16 Sep',
    time: '10:30 AM',
    advisor: 'Kamal',
    available: true,
  },
  {
    date: 'Wednesday 17 Sep',
    time: '9:00 AM',
    advisor: 'Jacob',
    available: true,
  },
  {
    date: 'Wednesday 17 Sep',
    time: '2:00 PM',
    advisor: 'Paul',
    available: true,
  },
  {
    date: 'Thursday 18 Sep',
    time: '11:00 AM',
    advisor: 'Kamal',
    available: true,
  },
];

export const MOCK_STAFF_MEMBERS: StaffMember[] = [
  {
    name: 'Kamal',
    role: 'Aftersales / Service Advisor',
    status: 'Available',
    department: 'Aftersales',
  },
  {
    name: 'Jacob',
    role: 'Sales Specialist',
    status: 'On another call',
    department: 'Sales',
  },
  {
    name: 'Paul',
    role: 'Service Advisor',
    status: 'Away from desk',
    department: 'Service',
  },
  {
    name: 'Nate',
    role: 'Sales Specialist',
    status: 'Available',
    department: 'Sales',
  },
  {
    name: 'Amina',
    role: 'Customer Experience / Sales',
    status: 'Available',
    department: 'Sales',
  },
  {
    name: 'Geoff Casey',
    role: 'Aftersales Manager',
    status: 'Available',
    department: 'Aftersales',
  },
  {
    name: 'Aaron Gabriel',
    role: 'General Manager',
    status: 'Available',
    department: 'Sales',
  },
];

export const ROADSIDE_ASSISTANCE = {
  'Land Rover': '1800 808 180',
  'Range Rover': '1800 808 180',
  Defender: '1800 808 180',
  Jaguar: '1800 819 181',
  Jaecoo: '1800 808 180',
  'INEOS Grenadier': '1800 808 180',
};

export const SITE_ROUTING = {
  jaecoo: {
    brand: 'Jaecoo / JQ / INEOS Grenadier',
    address: '996 King Georges Road, Blakehurst NSW 2221',
  },
  jlr: {
    brand: 'Jaguar / Land Rover / Range Rover / Defender',
    address: '990 King Georges Road, Blakehurst NSW 2221',
  },
};
