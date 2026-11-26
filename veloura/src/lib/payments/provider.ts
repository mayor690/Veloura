export type CreateInvoiceInput = {
  priceUsd: number;        // fiat price in USD
  orderId: string;         // our payments.reference
  description: string;
  ipnUrl: string;
  successUrl: string;
  cancelUrl: string;
};

/** Keep providers swappable (NOWPayments now; Paystack or others later). */
export interface PaymentProvider {
  name: string;
  configured(): boolean;
  createInvoice(input: CreateInvoiceInput): Promise<{ id: string; url: string }>;
}
