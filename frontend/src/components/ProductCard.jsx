import { useState } from "react";
import { motion } from "framer-motion";
import { spring } from "../lib/motion";

function truncate(s, n) {
  return s && s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Three real states, not just "has a URL or doesn't": no URL at all, still
 * loading (skeleton pulse), and failed to load (a broken/expired listing
 * image URL is common on real retailer data - onError falls back to the
 * same "no image" treatment rather than showing a broken-image icon). */
function ProductImage({ src }) {
  const [state, setState] = useState(src ? "loading" : "empty");

  if (state === "empty" || state === "error") {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <span className="text-ink/15 text-[10px] font-body">no image</span>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      {state === "loading" && (
        <motion.div
          className="absolute inset-0 bg-ink/5"
          animate={{ opacity: [0.35, 0.6, 0.35] }}
          transition={{ repeat: Infinity, duration: 1.3, ease: "easeInOut" }}
        />
      )}
      <img
        src={src}
        alt=""
        onLoad={() => setState("loaded")}
        onError={() => setState("error")}
        className={"h-full w-full object-cover transition-opacity duration-300 " +
                   (state === "loaded" ? "opacity-100" : "opacity-0")}
      />
    </div>
  );
}

/** `layout` (not layoutId) is what makes reordering during scoring animate
 * as one continuous rearrangement instead of a jump-cut - Framer Motion
 * FLIPs any card whose position in the list changes between renders. */
export default function ProductCard({ listing, reason }) {
  const dimmed = Boolean(reason);
  const hasLink = Boolean(listing.url);
  // QuickCommerce listings carry both: source is the provider
  // ("quickcommerce"), platform is the actual marketplace ("Flipkart").
  // Amazon/Rainforest listings have no platform, so this falls back to the
  // existing source badge exactly as before - zero visual change for them.
  const badgeLabel = listing.platform ?? listing.source;
  const outOfStock = listing.stock === 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 14, scale: 0.96 }}
      animate={{ opacity: dimmed ? 0.4 : 1, y: 0, scale: 1 }}
      transition={spring}
      className={
        "rounded-2xl border bg-panel p-4 flex gap-4 " +
        (dimmed ? "border-edge/60" : "border-edge")
      }
    >
      <div className="h-16 w-16 shrink-0 rounded-lg overflow-hidden bg-base/60">
        <ProductImage src={listing.image_url} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <a
            href={hasLink ? listing.url : undefined}
            target="_blank"
            rel="noreferrer"
            className={"text-sm font-body text-ink/90 leading-snug " + (hasLink ? "hover:text-violet-soft hover:underline" : "")}
          >
            {truncate(listing.title, 72)}
          </a>
          <a
            href={hasLink ? listing.url : undefined}
            target="_blank"
            rel="noreferrer"
            className={"shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide font-body " +
                       "bg-ink/5 text-ink/40 " + (hasLink ? "hover:text-violet-soft" : "")}
          >
            {badgeLabel}
          </a>
        </div>

        <div className="mt-2 flex items-center gap-3 text-xs text-ink/50 font-body flex-wrap">
          <span className="text-ink font-semibold text-sm">₹{listing.price?.toLocaleString("en-IN")}</span>
          {listing.mrp != null && listing.mrp > listing.price && (
            <span className="line-through text-ink/30">₹{listing.mrp.toLocaleString("en-IN")}</span>
          )}
          {listing.delivery_days != null && <span>{listing.delivery_days}d delivery</span>}
          {listing.rating != null && <span>★ {listing.rating}</span>}
          {listing.ram_gb && <span>{listing.ram_gb}GB RAM</span>}
          {listing.storage_gb && <span>{listing.storage_gb}GB {listing.storage_type ?? ""}</span>}
          {listing.pack_size && <span>{listing.pack_size}</span>}
        </div>

        {outOfStock && (
          <span className="mt-2 inline-block rounded-full bg-rose-500/10 border border-rose-500/30
                            px-2 py-0.5 text-[10px] text-rose-700 font-body">
            Out of stock
          </span>
        )}

        {reason && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={spring}
            className="mt-2 inline-block rounded-full bg-rose-500/10 border border-rose-500/30
                       px-2 py-0.5 text-[10px] text-rose-700 font-body"
          >
            {reason}
          </motion.span>
        )}
      </div>
    </motion.div>
  );
}
