// mobile/lib/models/print_settings.dart
//
// Plain Dart — no Flutter imports. Safe to use inside a compute() isolate.

// ---------------------------------------------------------------------------
// VoucherTemplateId
// ---------------------------------------------------------------------------

enum VoucherTemplateId {
  classic,
  detailed,
  strips;

  /// Wire name used in JSON (backend contract).
  String get wireName => name; // 'classic' | 'detailed' | 'strips'

  /// Parse from a wire string; unknown values fall back to [classic].
  static VoucherTemplateId fromWire(String? value) {
    for (final id in VoucherTemplateId.values) {
      if (id.wireName == value) return id;
    }
    return VoucherTemplateId.classic;
  }
}

// ---------------------------------------------------------------------------
// PrintKnobs
// ---------------------------------------------------------------------------

/// Template knob values that drive layout and content variations.
///
/// All fields have const defaults so a fresh [PrintKnobs()] is equivalent to
/// the absent-row case and produces Classic-parity output.
class PrintKnobs {
  final String headerText;    // '' = use router/business name
  final String footerText;    // '' = use default localized how-to (Detailed)
  final String hotspotAddress; // '' hides QR (Detailed)
  final bool showPrice;
  final bool showQr;
  final bool showBatch;
  final int stripsPerPage;    // 4..12 (Strips)

  const PrintKnobs({
    this.headerText = '',
    this.footerText = '',
    this.hotspotAddress = '',
    this.showPrice = false,
    this.showQr = false,
    this.showBatch = true,
    this.stripsPerPage = 8,
  });

  /// Tolerant parse: missing keys → defaults, stripsPerPage clamped 4..12.
  factory PrintKnobs.fromJson(Map<String, dynamic> json) {
    return PrintKnobs(
      headerText:      (json['headerText']     as String?)  ?? '',
      footerText:      (json['footerText']     as String?)  ?? '',
      hotspotAddress:  (json['hotspotAddress'] as String?)  ?? '',
      showPrice:       (json['showPrice']      as bool?)    ?? false,
      showQr:          (json['showQr']         as bool?)    ?? false,
      showBatch:       (json['showBatch']       as bool?)   ?? true,
      stripsPerPage:   ((json['stripsPerPage']  as int?)    ?? 8).clamp(4, 12),
    );
  }

  Map<String, dynamic> toJson() => {
    'headerText':     headerText,
    'footerText':     footerText,
    'hotspotAddress': hotspotAddress,
    'showPrice':      showPrice,
    'showQr':         showQr,
    'showBatch':      showBatch,
    'stripsPerPage':  stripsPerPage,
  };

  PrintKnobs copyWith({
    String? headerText,
    String? footerText,
    String? hotspotAddress,
    bool? showPrice,
    bool? showQr,
    bool? showBatch,
    int? stripsPerPage,
  }) =>
      PrintKnobs(
        headerText:     headerText     ?? this.headerText,
        footerText:     footerText     ?? this.footerText,
        hotspotAddress: hotspotAddress ?? this.hotspotAddress,
        showPrice:      showPrice      ?? this.showPrice,
        showQr:         showQr         ?? this.showQr,
        showBatch:      showBatch      ?? this.showBatch,
        stripsPerPage:  stripsPerPage  ?? this.stripsPerPage,
      );
}

// ---------------------------------------------------------------------------
// PrintSettings
// ---------------------------------------------------------------------------

class PrintSettings {
  final int codeLength;         // 6..12, default 8
  final VoucherTemplateId templateId;
  final int defaultColumns;     // 2..9, default 4
  final PrintKnobs knobs;

  const PrintSettings({
    this.codeLength    = 8,
    this.templateId    = VoucherTemplateId.classic,
    this.defaultColumns = 4,
    this.knobs         = const PrintKnobs(),
  });

  factory PrintSettings.fromJson(Map<String, dynamic> json) {
    return PrintSettings(
      codeLength:     (json['codeLength']     as int?)    ?? 8,
      templateId:     VoucherTemplateId.fromWire(json['templateId'] as String?),
      defaultColumns: (json['defaultColumns'] as int?)    ?? 4,
      knobs:          json['knobs'] is Map<String, dynamic>
                        ? PrintKnobs.fromJson(json['knobs'] as Map<String, dynamic>)
                        : const PrintKnobs(),
    );
  }

  Map<String, dynamic> toJson() => {
    'codeLength':     codeLength,
    'templateId':     templateId.wireName,
    'defaultColumns': defaultColumns,
    'knobs':          knobs.toJson(),
  };

  PrintSettings copyWith({
    int? codeLength,
    VoucherTemplateId? templateId,
    int? defaultColumns,
    PrintKnobs? knobs,
  }) =>
      PrintSettings(
        codeLength:     codeLength     ?? this.codeLength,
        templateId:     templateId     ?? this.templateId,
        defaultColumns: defaultColumns ?? this.defaultColumns,
        knobs:          knobs          ?? this.knobs,
      );

  /// Stable cache key incorporating template + knobs + columns.
  /// Used as the PdfPreview key so stale previews are discarded on change.
  String get cacheKey {
    final k = knobs;
    return '${templateId.wireName}'
        '|col=$defaultColumns'
        '|hdr=${k.headerText}'
        '|ftr=${k.footerText}'
        '|qa=${k.hotspotAddress}'
        '|sp=${k.showPrice}'
        '|sq=${k.showQr}'
        '|sb=${k.showBatch}'
        '|spp=${k.stripsPerPage}';
  }
}
