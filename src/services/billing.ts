import { API_BASE_URL, getHeaders, handleResponse, toApiError } from './apiClient';

export interface CreateBillingInvoicePayload {
  doctorName?: string;
  paymentType: string;
  customerName?: string;
  phoneNumber?: string;
  patientAge?: number | null;
  patientGender?: string;
  address?: string;
  gstin?: string;
  taxBreakdown: Array<{
    rate: number;
    taxable: number;
    cgst: number;
    sgst: number;
    igst: number;
  }>;
  totalQuantity: number;
  grossAmount: number;
  discountAmount: number;
  subtotal: number;
  flatDiscount: number;
  finalPayable: number;
  items: Array<{
    medicineId?: number | null;
    medicineName: string;
    batch: string;
    expiryDate: string;
    qty: number;
    pack: string;
    mrp: number;
    sellingPrice: number;
    discount: number;
    gstPercentage: number;
    gstAmount: number;
    hsnCode?: string;
    taxableAmount: number;
    total: number;
  }>;
}

export interface CreateBillingInvoiceResponse {
  success: boolean;
  message?: string;
  error?: string;
  data?: {
    invoice: Record<string, unknown>;
    items: Record<string, unknown>[];
  };
}

export const createBillingInvoice = async (
  payload: CreateBillingInvoicePayload
): Promise<CreateBillingInvoiceResponse> => {
  try {
    const res = await fetch(`${API_BASE_URL}/billing/invoice`, {
      method: 'POST',
      headers: getHeaders(),
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    const response = await handleResponse(res);
    const body: CreateBillingInvoiceResponse = await response.json().catch(() => ({
      success: false,
      error: 'The billing server returned an invalid response',
    }));

    if (!response.ok) {
      throw new Error(body.error || body.message || 'Failed to save invoice');
    }

    return body;
  } catch (error) {
    throw toApiError(error, 'Failed to save invoice');
  }
};

// ---------------------------------------------------------------------------
// Invoice listing / detail / update
// ---------------------------------------------------------------------------

export interface BillingInvoiceListItem {
  invoice_number: string;
  invoice_date: string;
  doctor_name: string | null;
  payment_type: string;
  customer_name: string | null;
  phone_number: string | null;
  patient_age: number | null;
  patient_gender: string | null;
  address: string | null;
  gstin: string | null;
  tax_breakdown: Array<{ rate: number; taxable: number; cgst: number; sgst: number; igst: number }>;
  total_quantity: number;
  gross_amount: string;
  discount_amount: string;
  subtotal: string;
  flat_discount: string;
  final_payable: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BillingInvoiceItem {
  item_id: number;
  invoice_number: string;
  medicine_id: number | null;
  medicine_name: string;
  batch: string;
  expiry_date: string;
  qty: number;
  pack: string;
  mrp: string;
  selling_price: string;
  discount: string;
  gst_percentage: string;
  gst_amount: string;
  hsn_code: string | null;
  taxable_amount: string;
  total: string;
}

export interface BillingInvoiceDetail {
  invoice: BillingInvoiceListItem;
  items: BillingInvoiceItem[];
}

export interface ListInvoicesParams {
  page?: number;
  limit?: number;
}

export interface ListInvoicesResponse {
  success: boolean;
  message?: string;
  error?: string;
  data?: BillingInvoiceListItem[];
  pagination?: { page: number; limit: number; total: number };
}

export interface GetInvoiceResponse {
  success: boolean;
  message?: string;
  error?: string;
  data?: BillingInvoiceDetail;
}

export interface UpdateBillingInvoicePayload {
  doctorName?: string;
  paymentType?: string;
  customerName?: string;
  phoneNumber?: string;
  patientAge?: number | null;
  patientGender?: string;
  address?: string;
  gstin?: string;
  taxBreakdown: Array<{ rate: number; taxable: number; cgst: number; sgst: number; igst: number }>;
  totalQuantity: number;
  grossAmount: number;
  discountAmount: number;
  subtotal: number;
  flatDiscount: number;
  finalPayable: number;
  items: CreateBillingInvoicePayload['items'];
}

export interface UpdateBillingInvoiceResponse {
  success: boolean;
  message?: string;
  error?: string;
  data?: {
    invoice: BillingInvoiceListItem;
    items: BillingInvoiceItem[];
  };
}

export const listBillingInvoices = async (
  params: ListInvoicesParams = {}
): Promise<ListInvoicesResponse> => {
  try {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        query.set(key, String(value));
      }
    });

    const res = await fetch(`${API_BASE_URL}/billing/invoices?${query.toString()}`, {
      method: 'GET',
      headers: getHeaders(),
      credentials: 'include',
    });

    const response = await handleResponse(res);
    const body: ListInvoicesResponse = await response.json().catch(() => ({}));

    if (!response.ok && response.status !== 404) {
      throw new Error(body.error || body.message || `Failed to fetch invoices (HTTP ${response.status})`);
    }

    return body;
  } catch (error) {
    throw toApiError(error, 'Failed to fetch invoices');
  }
};

export const getBillingInvoice = async (invoiceNumber: string): Promise<GetInvoiceResponse> => {
  try {
    const res = await fetch(`${API_BASE_URL}/billing/invoice/${encodeURIComponent(invoiceNumber)}`, {
      method: 'GET',
      headers: getHeaders(),
      credentials: 'include',
    });

    const response = await handleResponse(res);
    const body: GetInvoiceResponse = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(body.error || body.message || 'Failed to fetch invoice details');
    }

    return body;
  } catch (error) {
    throw toApiError(error, 'Failed to fetch invoice details');
  }
};

export const updateBillingInvoice = async (
  invoiceNumber: string,
  payload: UpdateBillingInvoicePayload
): Promise<UpdateBillingInvoiceResponse> => {
  try {
    const res = await fetch(`${API_BASE_URL}/billing/invoice/${encodeURIComponent(invoiceNumber)}`, {
      method: 'PATCH',
      headers: getHeaders(),
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    const response = await handleResponse(res);
    const body: UpdateBillingInvoiceResponse = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(body.error || body.message || 'Failed to update invoice');
    }

    return body;
  } catch (error) {
    throw toApiError(error, 'Failed to update invoice');
  }
};

export interface DeleteBillingInvoiceResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export const deleteBillingInvoice = async (
  invoiceNumber: string
): Promise<DeleteBillingInvoiceResponse> => {
  try {
    const res = await fetch(`${API_BASE_URL}/billing/invoice/${encodeURIComponent(invoiceNumber)}`, {
      method: 'DELETE',
      headers: getHeaders(),
      credentials: 'include',
    });

    const response = await handleResponse(res);
    const body: DeleteBillingInvoiceResponse = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(body.error || body.message || 'Failed to delete invoice');
    }

    return body;
  } catch (error) {
    throw toApiError(error, 'Failed to delete invoice');
  }
};
