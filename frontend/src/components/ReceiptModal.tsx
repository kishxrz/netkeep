"use client";

import React from "react";
import { LocalOrder, LocalOrderItem } from "../lib/types";
import { formatPaise } from "../lib/pricing";

interface ReceiptModalProps {
  order: (LocalOrder & { items?: LocalOrderItem[] }) | null;
  onClose: () => void;
}

export default function ReceiptModal({ order, onClose }: ReceiptModalProps) {
  if (!order) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white text-slate-900 rounded-2xl max-w-md w-full p-6 shadow-2xl relative font-mono text-xs animate-in fade-in zoom-in-95 duration-200">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-900 flex items-center justify-center font-bold text-sm cursor-pointer"
        >
          ✕
        </button>

        {/* Printable Receipt Container */}
        <div id="printable-receipt" className="space-y-4">
          {/* Header */}
          <div className="text-center border-b border-dashed border-slate-300 pb-4">
            <h2 className="text-base font-black tracking-wider uppercase text-slate-950">
              NetKeep Café & Arena
            </h2>
            <p className="text-[11px] text-slate-600">Branch: CAFE-BLR-01 • Indiranagar</p>
            <p className="text-[10px] text-slate-500">GSTIN: 29AAAAA0000A1Z5</p>

            <div className="mt-2 inline-block px-3 py-1 rounded bg-slate-100 font-bold text-slate-800 text-xs border border-slate-200">
              {order.order_code}
            </div>
          </div>

          {/* Metadata */}
          <div className="space-y-1 text-[11px] text-slate-700">
            <div className="flex justify-between">
              <span className="text-slate-500">UUID:</span>
              <span className="font-mono text-[10px] truncate max-w-[200px]" title={order.id}>
                {order.id}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Date:</span>
              <span>{new Date(order.created_at).toLocaleString('en-IN')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Customer:</span>
              <span className="font-semibold text-slate-900">{order.customer_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Payment:</span>
              <span className="font-bold">{order.payment_method}</span>
            </div>
          </div>

          {/* Line Items Table */}
          <div className="border-t border-b border-dashed border-slate-300 py-3">
            <table className="w-full text-left">
              <thead>
                <tr className="text-slate-500 border-b border-slate-200 pb-1 text-[10px] uppercase">
                  <th className="pb-1">Item</th>
                  <th className="pb-1 text-center">Qty</th>
                  <th className="pb-1 text-right">Price</th>
                  <th className="pb-1 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {order.items && order.items.length > 0 ? (
                  order.items.map((it) => (
                    <tr key={it.id || it.item_name} className="py-1">
                      <td className="py-1 font-medium text-slate-900 max-w-[150px] truncate">
                        {it.item_name}
                      </td>
                      <td className="py-1 text-center font-mono">{it.quantity}</td>
                      <td className="py-1 text-right font-mono text-slate-600">
                        {formatPaise(it.unit_price_paise)}
                      </td>
                      <td className="py-1 text-right font-mono font-bold text-slate-900">
                        {formatPaise(it.subtotal_paise)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="py-2 text-center text-slate-400">
                      Standard Order Package
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Financial Breakdown (Integer Paise Calculated) */}
          <div className="space-y-1.5 text-[11px] text-slate-700">
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span className="font-mono">{formatPaise(order.subtotal_paise)}</span>
            </div>
            <div className="flex justify-between">
              <span>GST (5%):</span>
              <span className="font-mono">{formatPaise(order.tax_paise)}</span>
            </div>
            {order.discount_paise > 0 && (
              <div className="flex justify-between text-emerald-700">
                <span>Discount:</span>
                <span className="font-mono">-{formatPaise(order.discount_paise)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-black text-slate-950 pt-2 border-t border-slate-300">
              <span>TOTAL PAID:</span>
              <span className="font-mono text-base">{formatPaise(order.total_paise)}</span>
            </div>
          </div>

          {/* Sync Status Badge */}
          <div className="pt-2 text-center">
            {order.status === "synced" ? (
              <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold border border-emerald-300">
                <span>✓</span>
                <span>Server Acknowledged & Synced</span>
              </div>
            ) : (
              <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold border border-amber-300">
                <span>🕒</span>
                <span>Local Pending (IndexedDB Persisted)</span>
              </div>
            )}
            {order.synced_at && (
              <p className="text-[9px] text-slate-400 mt-1">
                Synced at: {new Date(order.synced_at).toLocaleTimeString('en-IN')}
              </p>
            )}
          </div>

          {/* Footer message */}
          <div className="text-center pt-2 text-[10px] text-slate-400 border-t border-dashed border-slate-200">
            Thank you for visiting NetKeep Café!
            <br />
            Free Wi-Fi: <span className="font-bold text-slate-600">NetKeep-Guest</span> (VLAN 40)
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex space-x-3 pt-3 border-t border-slate-200">
          <button
            onClick={handlePrint}
            className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs flex items-center justify-center space-x-2 transition cursor-pointer"
          >
            <span>🖨️</span>
            <span>Print Receipt</span>
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold rounded-xl text-xs transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
