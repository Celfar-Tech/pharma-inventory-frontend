// Inventory management API calls
import { API_BASE_URL, getHeaders, toApiError, handleResponse } from './apiClient';

export interface InventoryItem {
  name: string;
  manufacturername: string;
  type: string;
  packsizelabel: string;
  composition1: string;
  mrp: number;
  batchnumber: string;
  shelfrackinfo: string;
  stockquantity: number;
  purchaseprice: number;
  sellingprice: number;
  stockalertthreshold: number;
  expirydate: string;
  insertdate: string;
  updatedate: string;
}

export interface InventoryRecord {
  id: number;
  name: string;
  manufacturer_name: string;
  type: string;
  pack_size_label: string;
  composition1: string;
  composition2: string;
  mrp: number | null;
  batch_number: string | null;
  shelf_rack_info: string | null;
  stock_quantity: number;
  purchase_price: number | null;
  selling_price: number | null;
  stock_alert_threshold: number;
  expiry_date: string | null;
  user_name: string | null;
  /** Optional: not always returned by the list endpoint. */
  image_url?: string | null;
  insert_date: string;
  update_date: string;
}

export interface InventoryListParams {
  name?: string;
  search?: string;
  manufacturer_name?: string;
  batch_number?: string;
  type?: string;
  composition1?: string;
  sortBy?: string;
  page?: number;
  limit?: number;
}

export interface InventoryListResponse {
  success: boolean;
  message?: string;
  error?: string;
  data?: InventoryRecord[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface BatchInfo {
  batchNumber: string;
  mrp: number;
  sellingPrice: number;
  expiryDate: string;
}

export interface BatchNumbersResponse {
  success: boolean;
  message?: string;
  error?: string;
  data: BatchInfo[];
}

export const getBatchNumbersByMedicine = async (name: string): Promise<BatchNumbersResponse> => {
  try {
    if (!name.trim()) {
      throw new Error('Medicine name is required');
    }

    const res = await fetch(`${API_BASE_URL}/inventory/batch-numbers?name=${encodeURIComponent(name)}`, {
      method: 'GET',
      headers: getHeaders(),
      credentials: 'include',
    });

    const response = await handleResponse(res);
    const body: BatchNumbersResponse = await response.json().catch(() => ({ success: false, data: [] }));
    if (!response.ok && response.status !== 404) {
      throw new Error(body.error || body.message || 'Failed to fetch batch numbers');
    }

    return body;
  } catch (error) {
    throw toApiError(error, 'Failed to fetch batch numbers');
  }
};

export const getInventoryList = async (params: InventoryListParams = {}): Promise<InventoryListResponse> => {
  try {
    const query = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        query.set(key, String(value));
      }
    });

    const res = await fetch(`${API_BASE_URL}/inventory/get-inventory?${query.toString()}`, {
      method: 'GET',
      headers: getHeaders(),
      credentials: 'include',
    });

    const response = await handleResponse(res);

    const body: InventoryListResponse = await response
      .json()
      .catch(() => ({} as InventoryListResponse));

    if (!response.ok && response.status !== 404) {
      throw new Error(
        body?.error || body?.message || `Failed to fetch inventory data (HTTP ${response.status})`
      );
    }

    return body;
  } catch (error) {
    throw toApiError(error, 'Failed to fetch inventory data');
  }
};

export const addInventory = async (item: InventoryItem): Promise<{ success: boolean; message: string }> => {
  try {
    const res = await fetch(`${API_BASE_URL}/inventory/add-inventory`, {
      method: 'POST',
      headers: getHeaders(),
      credentials: 'include',
      body: JSON.stringify(item),
    });
    const response = await handleResponse(res);
    if (!response.ok) {
      try {
        const errorData = await response.json();
        console.error("Backend Validation Error Details:", errorData);
      } catch (e) {
        console.error("Could not parse backend error body.", e);
      }
      throw new Error(`Failed to save inventory item: ${response.statusText}`);
    }

    return response.json();
  } catch (error) {
    throw toApiError(error, 'Failed to save inventory item');
  }
};

export const deleteInventoryItem = async ({ id, ...params }: { id: number | string; user: string; reason: string }): Promise<void> => {
  try {
    const query = new URLSearchParams(params).toString();
    const res = await fetch(`${API_BASE_URL}/inventory/delete-inventory/${id}?${query}`, {
      method: 'DELETE',
      headers: getHeaders(),
      credentials: 'include',
    });

    const response = await handleResponse(res);

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error || body?.message || 'Failed to delete inventory item');
    }
  } catch (error) {
    throw toApiError(error, 'Failed to delete inventory item');
  }
};
