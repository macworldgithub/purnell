import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Customer, CustomerDocument } from './schemas/customer.schema';
import {
  RepairOrder,
  RepairOrderDocument,
} from './schemas/repair-order.schema';
import { PartsOrder, PartsOrderDocument } from './schemas/parts-order.schema';
import {
  ServiceBooking,
  ServiceBookingDocument,
} from './schemas/service-booking.schema';
import {
  AuthorisedContact,
  AuthorisedContactDocument,
} from './schemas/authorised-contact.schema';

import { normalizeAustralianPhone } from '../common/utils/phone-normalizer';

export interface FullCustomerProfile {
  customer: Customer;
  repair_orders: RepairOrder[];
  parts_orders: PartsOrder[];
  service_bookings: ServiceBooking[];
  authorised_contacts: AuthorisedContact | null;
}

@Injectable()
export class CustomerDatabaseService {
  private readonly logger = new Logger(CustomerDatabaseService.name);

  constructor(
    @InjectModel(Customer.name)
    private readonly customerModel: Model<CustomerDocument>,
    @InjectModel(RepairOrder.name)
    private readonly repairOrderModel: Model<RepairOrderDocument>,
    @InjectModel(PartsOrder.name)
    private readonly partsOrderModel: Model<PartsOrderDocument>,
    @InjectModel(ServiceBooking.name)
    private readonly serviceBookingModel: Model<ServiceBookingDocument>,
    @InjectModel(AuthorisedContact.name)
    private readonly authorisedContactModel: Model<AuthorisedContactDocument>,
  ) {}

  /**
   * Escape special regex characters to prevent regex injection or syntax errors
   */
  private escapeRegex(str: string): string {
    return str.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
  }

  /**
   * Find customer by customer_id, phone, name, or vehicle rego
   */
  async findCustomer(query: string): Promise<Customer | null> {
    if (!query || typeof query !== 'string') return null;
    const qTrimmed = query.trim();
    if (!qTrimmed) return null;

    try {
      // Clean common conversational prefixes like "My name is...", "Rego is..."
      const cleanPhrase = qTrimmed
        .replace(
          /^(my name is|i am|it's|this is|rego is|registration is|the rego is|my vehicle is|my car is|licence is|name is|calling about|hi this is|hello this is|i'm)\s+/i,
          '',
        )
        .replace(/[?.!,]/g, '')
        .trim();

      const normalizedPhone =
        normalizeAustralianPhone(cleanPhrase) ||
        normalizeAustralianPhone(qTrimmed);
      const cleanDigits = cleanPhrase.replace(/[^0-9]/g, '');
      const cleanAlphanumeric = cleanPhrase
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase();

      // 1. Try direct customer_id match
      if (cleanAlphanumeric.length >= 3) {
        let customer = await this.customerModel
          .findOne({ customer_id: cleanAlphanumeric })
          .lean();
        if (customer) return customer;
      }

      // 2. Try normalized phone match (e.g. +61412000006)
      if (normalizedPhone) {
        let customer = await this.customerModel
          .findOne({
            $or: [
              { mobile: normalizedPhone },
              { landline: normalizedPhone },
            ],
          })
          .lean();
        if (customer) return customer;
      }

      // 3. Try digit substring match if query contains numbers (6+ digits)
      if (cleanDigits.length >= 6) {
        let customer = await this.customerModel
          .findOne({
            $or: [
              { mobile: { $regex: cleanDigits, $options: 'i' } },
              { landline: { $regex: cleanDigits, $options: 'i' } },
            ],
          })
          .lean();
        if (customer) return customer;
      }

      // 4. Try vehicle rego match (cleanAlphanumeric e.g. CF62ZZ or cleanPhrase e.g. C F 6 2 Z Z)
      if (cleanAlphanumeric.length >= 3 && cleanAlphanumeric.length <= 10) {
        // Match directly or regex
        let customer = await this.customerModel
          .findOne({
            'vehicles.rego': { $regex: `^${cleanAlphanumeric}$`, $options: 'i' },
          })
          .lean();
        if (customer) return customer;

        customer = await this.customerModel
          .findOne({
            'vehicles.rego': { $regex: cleanAlphanumeric, $options: 'i' },
          })
          .lean();
        if (customer) return customer;
      }

      // 5. Try customer full name, preferred name, or vehicle rego with cleanPhrase
      if (cleanPhrase.length >= 2) {
        const escapedPhrase = this.escapeRegex(cleanPhrase);
        let customer = await this.customerModel
          .findOne({
            $or: [
              { customer_name: { $regex: escapedPhrase, $options: 'i' } },
              { preferred_name: { $regex: escapedPhrase, $options: 'i' } },
              { 'vehicles.rego': { $regex: escapedPhrase, $options: 'i' } },
            ],
          })
          .lean();
        if (customer) return customer;
      }

      // 6. Token search (for compound queries e.g. "Jacob Wilson CF62ZZ", "Sarah Chen Defender")
      const words = cleanPhrase.split(/\s+/).filter((w) => w.length >= 2);
      for (const word of words) {
        const cleanWordAlpha = word.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        const escapedWord = this.escapeRegex(word);

        let customer = await this.customerModel
          .findOne({
            $or: [
              { customer_name: { $regex: escapedWord, $options: 'i' } },
              { preferred_name: { $regex: escapedWord, $options: 'i' } },
              { 'vehicles.rego': { $regex: cleanWordAlpha || escapedWord, $options: 'i' } },
            ],
          })
          .lean();
        if (customer) return customer;
      }

      return null;
    } catch (err: unknown) {
      this.logger.error(`Error searching customer for "${query}":`, err);
      return null;
    }
  }

  /**
   * Get complete connected profile for a customer (Customer + ROs + Parts + Bookings + Contacts)
   */
  async getFullCustomerProfile(
    query: string,
  ): Promise<FullCustomerProfile | null> {
    try {
      const customer = await this.findCustomer(query);
      if (!customer) {
        return null;
      }

      const customerId = customer.customer_id;

      const [
        repair_orders,
        parts_orders,
        service_bookings,
        authorised_contacts,
      ] = await Promise.all([
        this.repairOrderModel.find({ customer_id: customerId }).lean(),
        this.partsOrderModel.find({ customer_id: customerId }).lean(),
        this.serviceBookingModel.find({ customer_id: customerId }).lean(),
        this.authorisedContactModel.findOne({ customer_id: customerId }).lean(),
      ]);

      return {
        customer,
        repair_orders,
        parts_orders,
        service_bookings,
        authorised_contacts,
      };
    } catch (err: unknown) {
      this.logger.error(`Error fetching full customer profile for "${query}":`, err);
      return null;
    }
  }

  /**
   * Helper methods for direct entity queries by customer_id
   */
  async getRepairOrdersByCustomerId(
    customerId: string,
  ): Promise<RepairOrder[]> {
    return this.repairOrderModel.find({ customer_id: customerId }).lean();
  }

  async getPartsOrdersByCustomerId(customerId: string): Promise<PartsOrder[]> {
    return this.partsOrderModel.find({ customer_id: customerId }).lean();
  }

  async getServiceBookingsByCustomerId(
    customerId: string,
  ): Promise<ServiceBooking[]> {
    return this.serviceBookingModel.find({ customer_id: customerId }).lean();
  }

  async getAuthorisedContactsByCustomerId(
    customerId: string,
  ): Promise<AuthorisedContact | null> {
    return this.authorisedContactModel
      .findOne({ customer_id: customerId })
      .lean();
  }
}
