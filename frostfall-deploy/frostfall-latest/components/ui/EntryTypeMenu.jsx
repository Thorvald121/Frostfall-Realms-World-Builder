"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { FrostfallNavIcon } from "./FrostfallNavIcon";

/**
 * World-scoped entry creation dropdown. Native document listeners (capture phase)
 * let outside clicks proceed normally while dismissing the menu, unlike a modal
 * overlay that blocks interactions with the rest of the application.
 */
export default function EntryTypeMenu({
  categories,
  disabledCategories = [],
  onSelect,
  contextKey,
  buttonClassName = "fr-new-entry-btn",
  label = "New Entry",
  compact = false,
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  const trigger = useRef(null);
  const menu = useRef(null);
  const menuId = useId();
  const disabled = new Set(disabledCategories);
  const available = Object.entries(categories || {}).filter(([id]) => !disabled.has(id));

  // Changing a world or navigating to a different workspace closes the menu.
  useEffect(() => { setOpen(false); }, [contextKey]);

  useEffect(() => {
    if (!open) return undefined;
    const contains = (target) => !!(target && anchor.current?.contains(target));
    const outsidePointer = (event) => {
      if (!contains(event.target)) setOpen(false);
    };
    const outsideFocus = (event) => {
      if (!contains(event.target)) setOpen(false);
    };
    const escape = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outsidePointer, true);
    document.addEventListener("focusin", outsideFocus, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outsidePointer, true);
      document.removeEventListener("focusin", outsideFocus, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  const focusItem = (index) => {
    const items = Array.from(menu.current?.querySelectorAll('[role="menuitem"]') || []);
    if (items.length) items[((index % items.length) + items.length) % items.length].focus();
  };
  const onMenuKeyDown = (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(menu.current?.querySelectorAll('[role="menuitem"]') || []);
    const current = items.indexOf(document.activeElement);
    if (event.key === "Home") focusItem(0);
    if (event.key === "End") focusItem(items.length - 1);
    if (event.key === "ArrowDown") focusItem(current + 1);
    if (event.key === "ArrowUp") focusItem(current < 0 ? items.length - 1 : current - 1);
  };

  const toggle = () => {
    if (!open) {
      setOpen(true);
      // Focus stays on the trigger for normal mouse operation. ArrowDown opens
      // and places the keyboard focus on the first entry.
    } else setOpen(false);
  };

  return (
    <div className={`fr-create-anchor${compact ? " fr-create-anchor-compact" : ""}`} ref={anchor}>
      <button type="button" ref={trigger} className={buttonClassName}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            requestAnimationFrame(() => focusItem(event.key === "ArrowDown" ? 0 : available.length - 1));
          }
        }}>
        <Plus aria-hidden="true" size={15} /> {label}
        <ChevronDown aria-hidden="true" size={13} />
      </button>
      {open && (
        <div ref={menu} id={menuId} className="fr-create-menu" role="menu"
          aria-label="Choose entry category" onKeyDown={onMenuKeyDown}>
          <div className="fr-create-menu-label" role="presentation">Create a Codex entry</div>
          {available.map(([id, category]) => (
            <button key={id} type="button" role="menuitem" onClick={() => {
              setOpen(false);
              onSelect(id);
            }}>
              <span aria-hidden="true" style={{ color: category.color }}>
                <FrostfallNavIcon id={id} size={17} />
              </span>
              <span>{category.label}</span>
            </button>
          ))}
          {!available.length && <p className="fr-create-menu-label">No categories available for this world.</p>}
        </div>
      )}
    </div>
  );
}
