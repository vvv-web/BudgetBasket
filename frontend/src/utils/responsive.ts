/** Shared responsive widths for filter/select fields in page toolbars. */
export const filterFieldSx = (minWidth = 220) => ({
  minWidth: { xs: 0, sm: minWidth },
  width: { xs: '100%', sm: 'auto' },
  flex: { xs: '1 1 100%', sm: `1 1 ${minWidth}px` },
});
