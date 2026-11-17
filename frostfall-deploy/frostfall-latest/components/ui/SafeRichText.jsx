'use client';
import React, { useEffect, useState } from 'react';
import { parseSafeRichText } from '@/lib/domain/richTextSafety';

/**
 * Renders stored lore without dangerouslySetInnerHTML. The parsed source DOM
 * is never inserted into the document; only React elements from a whitelist
 * are constructed. SSR and first hydration both render an empty safe wrapper.
 */
export default function SafeRichText({ html, as = 'div', className = '', ...rest }) {
  const [tree, setTree] = useState([]);
  useEffect(() => { setTree(parseSafeRichText(html || '')); }, [html]);
  const render = (node, key) => node.kind === 'text' ? node.text :
    React.createElement(node.tag, { key, ...node.props }, ...node.children.map(render));
  return React.createElement(as, { ...rest, className: `ff-safe-rich-text ${className}`.trim() }, ...tree.map(render));
}
