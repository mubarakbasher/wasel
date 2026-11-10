// mobile/lib/services/print/grid_layout.dart
//
// A4 grid-math constants and helpers extracted from print_service.dart so that
// card templates can import them without creating a circular dependency.
// print_service.dart re-exports everything from here.

import 'package:pdf/pdf.dart';

// ---------------------------------------------------------------------------
// Page/gutter constants
// ---------------------------------------------------------------------------

const double kPrintMarginH = 16;
const double kPrintMarginV = 16;
const double kPrintGutterH = 4;
const double kPrintGutterV = 3;

/// Minimum column count the print slider exposes to operators.
const int kMinPrintColumns = 2;

/// Maximum column count the print slider exposes to operators.
const int kMaxPrintColumns = 9;

// ---------------------------------------------------------------------------
// VoucherGridLayout
// ---------------------------------------------------------------------------

/// Computed voucher-card dimensions and row count for an A4 page.
class VoucherGridLayout {
  /// Card width in points.
  final double cardW;

  /// Card height in points.
  final double cardH;

  /// Number of card rows that fit on a single A4 page.
  final int rows;

  /// Column count used to construct this layout.
  final int columns;

  const VoucherGridLayout({
    required this.cardW,
    required this.cardH,
    required this.rows,
    required this.columns,
  });

  /// Number of voucher cards that fit on one A4 page.
  int get perPage => rows * columns;
}

// ---------------------------------------------------------------------------
// Grid math
// ---------------------------------------------------------------------------

/// Returns the [VoucherGridLayout] for an A4 page with [columns] columns and
/// the standard Wasel print margins and gutters.
VoucherGridLayout voucherGridLayoutFor(int columns) {
  final pageFormat = PdfPageFormat.a4.copyWith(
    marginLeft: kPrintMarginH,
    marginRight: kPrintMarginH,
    marginTop: kPrintMarginV,
    marginBottom: kPrintMarginV,
  );

  final double usableW = pageFormat.availableWidth;
  final double usableH = pageFormat.availableHeight;

  final double cardW = (usableW - kPrintGutterH * (columns - 1)) / columns;
  final double cardH = (cardW * 0.62).clamp(56.0, 150.0);
  final int rows = ((usableH + kPrintGutterV) / (cardH + kPrintGutterV)).floor();

  return VoucherGridLayout(
    cardW: cardW,
    cardH: cardH,
    rows: rows,
    columns: columns,
  );
}

/// Returns the total number of A4 pages for [itemCount] items in [columns] columns.
int voucherPdfPageCount(int itemCount, int columns) {
  if (itemCount <= 0) return 0;
  final perPage = voucherGridLayoutFor(columns).perPage;
  return (itemCount / perPage).ceil();
}

/// Card padding (in points) for [columns] columns.
double voucherCardPadding(int columns) =>
    (6 - (columns - 2) * 0.5).clamp(2.5, 6.0);

/// Letter spacing (in points) for the voucher code at [columns] columns.
double voucherCodeLetterSpacing(int columns) =>
    (1 - (columns - 6) * 0.2).clamp(0.4, 1.0);
