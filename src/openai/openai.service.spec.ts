import { OpenAiService } from './openai.service';
import { PentanaService } from '../pentana/pentana.service';
import { CustomerDatabaseService } from '../customer-database/customer-database.service';

interface VerificationResult {
  verified: boolean;
  message?: string;
  customer?: {
    customer_id: string;
    customer_name: string;
  };
}

describe('OpenAiService privacy verification', () => {
  const nameProfile = {
    customer: {
      customer_id: 'CUS-00011',
      customer_name: 'Fatima Al-Rashid',
      preferred_name: 'Fatima',
      mobile: '04120000011',
      landline: null,
      vehicles: [{ rego: 'HIJ456' }],
    },
    repair_orders: [],
    service_bookings: [],
    parts_orders: [],
    authorised_contacts: null,
  };
  const registrationProfile = {
    customer: {
      customer_id: 'CUS-00009',
      customer_name: 'Priya Sharma',
      preferred_name: 'Priya',
      mobile: '04120000009',
      landline: null,
      vehicles: [{ rego: 'BCD890' }],
    },
    repair_orders: [],
    service_bookings: [],
    parts_orders: [],
    authorised_contacts: null,
  };

  it('does not disclose either record when name and registration do not match', async () => {
    const customerDatabaseService = {
      getFullCustomerProfile: jest.fn((query: string) => {
        if (query === 'Fatima Al-Rashid') return Promise.resolve(nameProfile);
        if (query === 'BCD890') return Promise.resolve(registrationProfile);
        return Promise.resolve(null);
      }),
    } as unknown as CustomerDatabaseService;
    const service = new OpenAiService(
      {} as PentanaService,
      customerDatabaseService,
    );

    const result = JSON.parse(
      await service.executeToolCall('verifyPentanaCustomer', {
        customerName: 'Fatima Al-Rashid',
        registration: 'BCD890',
      }),
    ) as VerificationResult;

    expect(result).toEqual({
      verified: false,
      message:
        'Unable to verify those details. Please check the information and try again.',
    });
    expect(JSON.stringify(result)).not.toContain('Priya');
    expect(JSON.stringify(result)).not.toContain('Fatima');
    expect(JSON.stringify(result)).not.toContain('BCD890');
  });

  it('returns the profile only when both factors resolve to the same record', async () => {
    const customerDatabaseService = {
      getFullCustomerProfile: jest.fn().mockResolvedValue(nameProfile),
    } as unknown as CustomerDatabaseService;
    const service = new OpenAiService(
      {} as PentanaService,
      customerDatabaseService,
    );

    const result = JSON.parse(
      await service.executeToolCall('verifyPentanaCustomer', {
        customerName: 'Fatima Al-Rashid',
        registration: 'HIJ456',
      }),
    ) as VerificationResult & {
      customer: {
        customer_id: string;
        customer_name: string;
      };
    };

    expect(result.verified).toBe(true);
    expect(result.customer.customer_id).toBe('CUS-00011');
    expect(result.customer.customer_name).toBe('Fatima Al-Rashid');
  });
});
