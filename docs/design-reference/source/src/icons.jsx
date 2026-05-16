// Tiny shared SVG icon set. Strokes use currentColor so each direction
// can re-tint by setting `color` on a wrapper.

const IconUpload = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="square">
    <path d="M8 11V2.5" />
    <path d="M4.5 6L8 2.5L11.5 6" />
    <path d="M2.5 11v2.5h11V11" />
  </svg>
);

const IconFile = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="square">
    <path d="M3 1.5h6.5l3 3V14.5H3z" />
    <path d="M9 1.5v3h3" />
  </svg>
);

const IconDot = ({ size = 8 }) => (
  <svg width={size} height={size} viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" fill="currentColor" /></svg>
);

const IconCheck = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
    <path d="M2.5 6.5L5 9L10 3.5" />
  </svg>
);

const IconWarn = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.25">
    <path d="M6 1.5L11 10.5H1z" />
    <path d="M6 5v3" strokeLinecap="square" />
    <circle cx="6" cy="9.5" r="0.4" fill="currentColor" />
  </svg>
);

const IconX = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="square">
    <path d="M3 3L9 9M9 3L3 9" />
  </svg>
);

const IconSpinner = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="7" cy="7" r="5" opacity="0.25" />
    <path d="M7 2a5 5 0 0 1 5 5">
      <animateTransform attributeName="transform" type="rotate" from="0 7 7" to="360 7 7" dur="1.1s" repeatCount="indefinite" />
    </path>
  </svg>
);

const IconChevron = ({ size = 10 }) => (
  <svg width={size} height={size} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="square">
    <path d="M3 1.5L7 5L3 8.5" />
  </svg>
);

Object.assign(window, { IconUpload, IconFile, IconDot, IconCheck, IconWarn, IconX, IconSpinner, IconChevron });
