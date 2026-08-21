import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { spring } from "../lib/motion";
import { checkoutRun } from "../lib/api";

const STEPS = [
  { id: 1, text: "Verifying live vendor inventory & locking lowest price..." },
  { id: 2, text: "Dispatching automated fulfillment agents to merchant stores..." },
  { id: 3, text: "Testing and auto-applying best promotional coupons..." },
  { id: 4, text: "Authorizing secure universal payment..." },
  { id: 5, text: "Multi-vendor orders confirmed & tracking numbers generated!" },
];

export default function CheckoutModal({ isOpen, onClose, runId, decision, singleItem = null, onOrderSuccess }) {
  const navigate = useNavigate();

  // Load saved profile or defaults
  const [name, setName] = useState(() => localStorage.getItem("shopyx_user_name") || "Jeevan Sai");
  const [email, setEmail] = useState(() => localStorage.getItem("shopyx_user_email") || "jeevan@example.com");
  const [phone, setPhone] = useState(() => localStorage.getItem("shopyx_user_phone") || "+91 98765 43210");
  const [address, setAddress] = useState(
    () => localStorage.getItem("shopyx_user_address") || "Flat 402, Sai Residency, Hitech City, Hyderabad"
  );
  const [pincode, setPincode] = useState(() => localStorage.getItem("shopyx_user_pincode") || "500081");
  const [paymentMethod, setPaymentMethod] = useState("upi");
  const [upiId, setUpiId] = useState("jeevan@oksbi");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [confirmedOrder, setConfirmedOrder] = useState(null);
  const [error, setError] = useState(null);

  // Determine line items
  const lines = singleItem
    ? [
        {
          source: singleItem.source,
          product_id: singleItem.product_id,
          title: singleItem.title,
          qty: 1,
          unit_price: singleItem.price,
          delivery_days: singleItem.delivery_days,
        },
      ]
    : decision?.chosen?.lines || [];

  const baseTotal = lines.reduce((acc, l) => acc + (l.unit_price || 0) * (l.qty || 1), 0);
  const discount = baseTotal > 2000 ? Math.round(baseTotal * 0.05) : 0;
  const finalTotal = baseTotal - discount;

  // Distinct vendors
  const vendors = Array.from(new Set(lines.map((l) => l.source)));

  async function handleConfirmOrder(e) {
    e.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    setCurrentStep(1);

    // Save profile info to local storage
    try {
      localStorage.setItem("shopyx_user_name", name);
      localStorage.setItem("shopyx_user_email", email);
      localStorage.setItem("shopyx_user_phone", phone);
      localStorage.setItem("shopyx_user_address", address);
      localStorage.setItem("shopyx_user_pincode", pincode);
    } catch {}

    // Simulated multi-step agent progression
    const t1 = setTimeout(() => setCurrentStep(2), 700);
    const t2 = setTimeout(() => setCurrentStep(3), 1400);
    const t3 = setTimeout(() => setCurrentStep(4), 2100);

    try {
      const orderPayload = {
        customer_name: name,
        customer_email: email,
        customer_phone: phone,
        shipping_address: address,
        pincode: pincode,
        payment_method: paymentMethod,
        custom_lines: singleItem ? lines : null,
      };

      const result = await checkoutRun(runId, orderPayload);

      setTimeout(() => {
        setCurrentStep(5);
        setConfirmedOrder(result);
        setIsSubmitting(false);
        if (onOrderSuccess) onOrderSuccess(result);
      }, 2600);
    } catch (err) {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      setIsSubmitting(false);
      setError(err.message || "Failed to process universal checkout");
    }
  }

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => !isSubmitting && onClose()}
          className="fixed inset-0 bg-ink/60 backdrop-blur-sm transition-opacity"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 16 }}
          transition={spring}
          className="relative w-full max-w-2xl rounded-3xl border border-edge bg-panel p-6 sm:p-8 shadow-2xl shadow-violet/20 z-10 my-8 max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-edge/60 pb-4">
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet/15 text-violet">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                >
                  <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <path d="M16 10a4 4 0 0 1-8 0" />
                </svg>
              </span>
              <div>
                <h2 className="font-display text-xl font-bold text-ink">
                  Universal One-Click Checkout
                </h2>
                <p className="text-xs text-ink/50 font-body">
                  Automated fulfillment across {vendors.join(" & ")}
                </p>
              </div>
            </div>

            {!isSubmitting && (
              <button
                type="button"
                onClick={onClose}
                className="rounded-full p-2 text-ink/40 hover:bg-ink/5 hover:text-ink transition-colors"
              >
                ✕
              </button>
            )}
          </div>

          {/* Success State */}
          {confirmedOrder ? (
            <div className="mt-6 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 mb-4">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-8 w-8 animate-bounce"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>

              <h3 className="font-display text-2xl font-bold text-ink">
                Multi-Vendor Order Confirmed!
              </h3>
              <p className="mt-1 text-sm text-ink/60 font-body">
                Invoice <span className="font-semibold text-ink">{confirmedOrder.invoice_number}</span> has been generated and dispatched.
              </p>

              {/* Multi-carrier split shipments card */}
              <div className="mt-6 rounded-2xl border border-edge bg-base/70 p-4 text-left">
                <h4 className="text-xs font-bold uppercase tracking-wider text-ink/50 font-body mb-3">
                  Live Vendor Shipments & Tracking IDs
                </h4>

                <div className="space-y-3">
                  {confirmedOrder.split_shipments.map((shipment, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl border border-edge bg-panel p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-md bg-violet/10 px-2 py-0.5 text-xs font-semibold text-violet">
                            {shipment.vendor}
                          </span>
                          <span className="text-xs font-medium text-ink/80 truncate max-w-[240px]">
                            {shipment.title} (Qty: {shipment.qty})
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-ink/40 font-body font-mono">
                          Tracking: <span className="text-ink font-semibold">{shipment.tracking_number}</span>
                        </p>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="inline-block rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                          ETA: {shipment.delivery_eta}
                        </span>
                        <p className="text-xs font-bold text-ink mt-0.5">
                          ₹{shipment.total_price.toLocaleString("en-IN")}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    navigate("/ledger");
                  }}
                  className="w-full sm:w-auto rounded-xl bg-violet px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet/25 hover:bg-violet-deep transition-all"
                >
                  Track in Ledger History &rarr;
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full sm:w-auto rounded-xl border border-edge bg-panel px-6 py-3 text-sm font-medium text-ink/75 hover:text-ink transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          ) : isSubmitting ? (
            /* Live Execution Animation */
            <div className="mt-8 py-6 text-center">
              <div className="relative mx-auto h-20 w-20 flex items-center justify-center mb-6">
                <motion.div
                  className="absolute inset-0 rounded-full border-4 border-violet/20 border-t-violet"
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                />
                <span className="text-2xl">🤖</span>
              </div>

              <h3 className="font-display text-xl font-bold text-ink">
                Fulfillment Agents at Work...
              </h3>
              <p className="mt-1 text-xs text-ink/50 font-body max-w-sm mx-auto">
                Executing automated single-click checkout across {vendors.join(", ")}
              </p>

              {/* Progress Steps */}
              <div className="mt-8 max-w-md mx-auto space-y-3 text-left">
                {STEPS.map((s) => {
                  const isDone = currentStep > s.id;
                  const isCurrent = currentStep === s.id;
                  return (
                    <div
                      key={s.id}
                      className={`flex items-center gap-3 rounded-xl p-3 text-xs font-medium transition-all ${
                        isDone
                          ? "bg-emerald-500/10 text-emerald-800 border border-emerald-500/20"
                          : isCurrent
                          ? "bg-violet/10 text-violet border border-violet/30 shadow-sm"
                          : "text-ink/30 border border-transparent"
                      }`}
                    >
                      <span
                        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
                          isDone
                            ? "bg-emerald-500 text-white"
                            : isCurrent
                            ? "bg-violet text-white"
                            : "bg-ink/10 text-ink/40"
                        }`}
                      >
                        {isDone ? "✓" : s.id}
                      </span>
                      <span className="flex-1 font-body">{s.text}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Checkout Form */
            <form onSubmit={handleConfirmOrder} className="mt-6 space-y-6">
              {error && (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-700 font-body">
                  {error}
                </div>
              )}

              {/* Items to Purchase Preview */}
              <div className="rounded-2xl border border-edge bg-base/60 p-4">
                <div className="flex items-center justify-between text-xs font-semibold text-ink/60 font-body mb-2.5">
                  <span>Order Items ({lines.length})</span>
                  <span>Vendor Allocation</span>
                </div>

                <div className="space-y-2">
                  {lines.map((line, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-3 text-xs text-ink/80 border-b border-edge/40 pb-2 last:border-0 last:pb-0"
                    >
                      <div className="min-w-0 truncate">
                        <span className="font-medium">{line.title}</span>
                        <span className="text-ink/40"> · Qty {line.qty}</span>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="rounded bg-violet/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet mr-2">
                          {line.source}
                        </span>
                        <span className="font-semibold text-ink">
                          ₹{((line.unit_price || 0) * (line.qty || 1)).toLocaleString("en-IN")}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Auto Coupon */}
                {discount > 0 && (
                  <div className="mt-3 flex items-center justify-between rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-xs text-emerald-800 font-medium">
                    <span className="flex items-center gap-1.5">
                      <span>🎟️</span>
                      <span>Auto-coupon <strong>SHOPYX5</strong> applied</span>
                    </span>
                    <span className="font-semibold">-₹{discount.toLocaleString("en-IN")}</span>
                  </div>
                )}
              </div>

              {/* Delivery Address Form */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-ink/50 font-body mb-3">
                  1. Shipping & Contact Address
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-ink/50 font-body">Full Name</label>
                    <input
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-edge bg-base px-3.5 py-2 text-xs text-ink outline-none focus:border-violet/50"
                      placeholder="Your Name"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-ink/50 font-body">Phone Number</label>
                    <input
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-edge bg-base px-3.5 py-2 text-xs text-ink outline-none focus:border-violet/50"
                      placeholder="+91 98765 43210"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[11px] text-ink/50 font-body">Delivery Street Address</label>
                    <input
                      required
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-edge bg-base px-3.5 py-2 text-xs text-ink outline-none focus:border-violet/50"
                      placeholder="House/Flat No, Street, Landmark, City"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-ink/50 font-body">Pincode</label>
                    <input
                      required
                      value={pincode}
                      onChange={(e) => setPincode(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-edge bg-base px-3.5 py-2 text-xs text-ink outline-none focus:border-violet/50"
                      placeholder="500081"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-ink/50 font-body">Email Receipt</label>
                    <input
                      required
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-edge bg-base px-3.5 py-2 text-xs text-ink outline-none focus:border-violet/50"
                      placeholder="you@company.com"
                    />
                  </div>
                </div>
              </div>

              {/* Payment Methods */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-ink/50 font-body mb-3">
                  2. Payment Method
                </h3>
                <div className="grid grid-cols-3 gap-2.5">
                  {[
                    { id: "upi", label: "Instant UPI", icon: "⚡" },
                    { id: "card", label: "Credit / Debit Card", icon: "💳" },
                    { id: "netbanking", label: "Corporate NetBanking", icon: "🏢" },
                  ].map((method) => (
                    <button
                      key={method.id}
                      type="button"
                      onClick={() => setPaymentMethod(method.id)}
                      className={`rounded-xl border p-3 text-center transition-all ${
                        paymentMethod === method.id
                          ? "border-violet bg-violet/10 text-violet font-semibold shadow-sm"
                          : "border-edge bg-base text-ink/70 hover:border-violet/30"
                      }`}
                    >
                      <span className="text-base block mb-1">{method.icon}</span>
                      <span className="text-[11px] block">{method.label}</span>
                    </button>
                  ))}
                </div>

                {paymentMethod === "upi" && (
                  <div className="mt-3">
                    <label className="text-[11px] text-ink/50 font-body">Virtual Payment Address (UPI ID)</label>
                    <input
                      value={upiId}
                      onChange={(e) => setUpiId(e.target.value)}
                      placeholder="username@okhdfcbank"
                      className="mt-1 w-full rounded-xl border border-edge bg-base px-3.5 py-2 text-xs text-ink outline-none focus:border-violet/50"
                    />
                  </div>
                )}
              </div>

              {/* Submit Section */}
              <div className="border-t border-edge/80 pt-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <span className="text-xs text-ink/50 font-body">Total Landed Amount</span>
                  <div className="text-xl font-bold text-ink font-display">
                    ₹{finalTotal.toLocaleString("en-IN")}
                    <span className="text-xs font-normal text-emerald-600 ml-2 font-body">
                      (All taxes & multi-store shipping incl.)
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 sm:flex-none rounded-xl border border-edge bg-base px-5 py-3 text-xs font-semibold text-ink/70 hover:text-ink transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 sm:flex-none rounded-xl bg-violet px-7 py-3 text-xs font-bold text-white shadow-lg shadow-violet/25 hover:bg-violet-deep transition-all flex items-center justify-center gap-1.5"
                  >
                    <span>⚡ Place Order Now</span>
                  </button>
                </div>
              </div>
            </form>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
