# MBRLR Portal — Financial Review and Reporting

The MBRLR portal brings IPAS Excel reports into one place for financial review. After the six required files are selected and synced through the desktop GUI, the portal refreshes its data for viewing, filtering, drill-down and report preparation.

| View | Presentation point |
| --- | --- |
| Summary | Review the overall budget, expenditure and balance position. |
| Month-wise Actuals and PU Master | Review monthly bookings and individual PU details. |
| Trends and AI Analysis | Explore comparison charts and automated observations requiring review. |
| BP Analysis and Budget Control | Identify excess expenditure, potential savings and watch-list items. |
| AE vs BP Statement | View an Excel-style report with all-PU/HQ selection and custom sorting. |
| Department / Demand / SMH | Narrow the review to the relevant department, expenditure head or PU. |
| Remarks and Review | Keep supporting observations alongside financial information. |

Excel downloads support detailed scrutiny, PowerPoint summaries support review meetings, and PDF reports support circulation. New exports use the currently loaded data; previously downloaded files must be downloaded again after a refresh.

Compared with the manual workflow after IPAS extraction, the portal reduces repeated copying, filtering and assembling of tables for Excel and PPT. IPAS remains the source of accounting data; the portal supports subsequent review and reporting.

## Internal check — 14 September 2026

| Check | Result |
| --- | --- |
| Source freshness | All six source files match the recorded portal data hashes. |
| Reporting period | Completed through August 2026; September 2026 running. Last sync: 11 September 2026, 11:09 IST. |
| Calculation tests | Passed for 41 operational source PUs, six liability scenarios and mixed RG/BG cases across 12 months. |
| Data reconciliation | Zero PU-month mismatches; 910 department detail rows and 12 Demand/SMH rows checked. |
| Page definitions | All 13 page definitions and required renderer functions found. This is a code check, not a visual page test. |
| Export rules | Excel/PDF/PPT generator and freshness checks passed. Code rules include minimum 10-point fonts and two-decimal crore values in Excel/PDF. |

Visual page operation, screenshots and actual Excel/PDF browser downloads remain unverified because browser access is blocked by administrator-policy verification. The internal checks above do not establish rendered layout or download success.

Suggested live demonstration: Summary → Trends → AE vs BP Statement → Excel/PPT export.
