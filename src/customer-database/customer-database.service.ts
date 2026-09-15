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
   * Find customer by customer_id, phone, name, or vehicle rego
   */
  async findCustomer(query: string): Promise<Customer | null> {
    const qTrimmed = query.trim();
    const normalizedPhone = normalizeAustralianPhone(qTrimmed);
    const cleanDigits = qTrimmed.replace(/[^0-9]/g, '');

    // Try direct customer_id match
    let customer = await this.customerModel
      .findOne({ customer_id: qTrimmed.toUpperCase() })
      .lean();

    if (customer) return customer;

    // Try normalized phone match first
    if (normalizedPhone) {
      customer = await this.customerModel
        .findOne({
          $or: [
            { mobile: normalizedPhone },
            { landline: normalizedPhone },
          ],
        })
        .lean();

      if (customer) return customer;
    }

    // Try digit substring match if query contains numbers
    if (cleanDigits.length >= 6) {
      customer = await this.customerModel
        .findOne({
          $or: [
            { mobile: { $regex: cleanDigits, $options: 'i' } },
            { landline: { $regex: cleanDigits, $options: 'i' } },
          ],
        })
        .lean();

      if (customer) return customer;
    }

    // Try vehicle rego or customer name match
    customer = await this.customerModel
      .findOne({
        $or: [
          { customer_name: { $regex: qTrimmed, $options: 'i' } },
          { preferred_name: { $regex: qTrimmed, $options: 'i' } },
          { 'vehicles.rego': { $regex: qTrimmed, $options: 'i' } },
        ],
      })
      .lean();

    return customer;
  }

  /**
   * Get complete connected profile for a customer (Customer + ROs + Parts + Bookings + Contacts)
   */
  async getFullCustomerProfile(
    query: string,
  ): Promise<FullCustomerProfile | null> {
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
