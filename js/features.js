function toggleBackupAccordion(forceOpen = null) {
  const body = document.getElementById("backupAccordionBody");
  const header = document.getElementById("backupAccordionHeader");
  const chevron = document.getElementById("backupAccordionChevron");
  if (!body || !header || !chevron) return;

  const willOpen = forceOpen === null
    ? body.style.display === "none"
    : !!forceOpen;

  body.style.display = willOpen ? "block" : "none";
  header.setAttribute("aria-expanded", willOpen ? "true" : "false");
  chevron.textContent = willOpen ? "▲" : "▼";
}
