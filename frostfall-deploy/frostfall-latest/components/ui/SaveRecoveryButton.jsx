"use client";

/** A one-click emergency export, no database or external connection required. */
export function SaveRecoveryButton({ fileName, getContent, children, style = {} }) {
  const download = () => {
    try {
      const content = getContent();
      if (!content) throw new Error("No recovery content available");
      const blob = new Blob([content], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch (error) {
      window.alert(`Recovery export failed: ${error.message}`);
    }
  };
  return <button type="button" onClick={download} style={style}>{children}</button>;
}
