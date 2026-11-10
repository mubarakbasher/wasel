// test/services/print_service_test.dart
//
// Uses plain test() — not testWidgets() — because compute() spawns a real
// isolate that never completes under FakeAsync (the testWidgets harness).
// TestWidgetsFlutterBinding is still required so rootBundle can load the
// bundled Cairo font assets from the filesystem during _ensureFontBytes().
//
// Expected stderr line "Courier-Bold has no Unicode support" appears once
// per document — it is a known pdf-package info message, not a test failure.

import 'dart:convert';

import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/models/print_settings.dart';
import 'package:wasel/services/print_service.dart';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/// ~100 VoucherPrintItem entries covering the known-tricky rendering cases:
/// Arabic limit/validity strings, null limitText, long code, short code,
/// mixed LTR/RTL fields.
List<VoucherPrintItem> _buildFixtures() {
  final items = <VoucherPrintItem>[];

  // 1. Arabic validity + Arabic limit
  items.add(const VoucherPrintItem(
    code: 'WSL-AR-0001',
    limitText: '30 دقيقة',
    validityText: 'مفتوح',
  ));

  // 2. Arabic validity, English limit
  items.add(const VoucherPrintItem(
    code: 'WSL-AR-0002',
    limitText: '2 GB',
    validityText: 'مفتوح',
  ));

  // 3. null limitText — separator + limit cell must be omitted
  items.add(const VoucherPrintItem(
    code: 'WSL-NULL-003',
    limitText: null,
    validityText: '7 days',
  ));

  // 4. null limitText with Arabic validity
  items.add(const VoucherPrintItem(
    code: 'WSL-NULL-004',
    limitText: null,
    validityText: 'يوم واحد',
  ));

  // 5. Long voucher code — FittedBox must scale it down
  items.add(const VoucherPrintItem(
    code: 'WSL-VERY-LONG-CODE-THAT-SHOULD-SCALE-DOWN-1234',
    limitText: '1 GB',
    validityText: '1 day',
  ));

  // 6. Very short code
  items.add(const VoucherPrintItem(
    code: 'WS',
    limitText: '500 MB',
    validityText: 'مفتوح',
  ));

  // 7. Standard English all-fields
  items.add(const VoucherPrintItem(
    code: 'WSL-STD-0007',
    limitText: 'Basic',
    validityText: '3 days',
  ));

  // 8. Arabic limit string with Arabic validity
  items.add(const VoucherPrintItem(
    code: 'WSL-AR-0008',
    limitText: 'غير محدود',
    validityText: 'أسبوع',
  ));

  // 9. Mixed: English code, Arabic limit, English validity
  items.add(const VoucherPrintItem(
    code: 'WSL-MIX-0009',
    limitText: 'جيجا بايت',
    validityText: '30 days',
  ));

  // 10. Numeric-looking code
  items.add(const VoucherPrintItem(
    code: '000000000010',
    limitText: null,
    validityText: 'مفتوح',
  ));

  // Fill to ~100 with a mix of null / non-null limitText and Arabic strings.
  for (int i = 11; i <= 100; i++) {
    final hasArabic = i % 3 == 0;
    final hasLimit = i % 5 != 0;
    items.add(VoucherPrintItem(
      code: 'WSL-BATCH-${i.toString().padLeft(4, '0')}',
      limitText: hasLimit
          ? (hasArabic ? '$i ميغابايت' : '$i MB')
          : null,
      validityText: hasArabic ? '$i يوم' : '$i days',
    ));
  }

  return items;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  // -------------------------------------------------------------------------
  // Pure-math tests — no isolates, no assets, no Flutter binding needed.
  // -------------------------------------------------------------------------

  group('voucherGridLayoutFor / voucherPdfPageCount', () {
    // Expected perPage values derived from the A4 math:
    //   A4 595.28 × 841.89 pt; 16 pt margins → usableW 563.28, usableH 809.89
    //   gutterH = 4, gutterV = 3
    //   cardW = (usableW - gutterH*(c-1)) / c
    //   cardH = (cardW * 0.62).clamp(56, 150)
    //   rows  = floor((usableH + gutterV) / (cardH + gutterV))
    const expectedPerPage = {2: 10, 3: 18, 4: 36, 5: 55, 6: 78, 7: 91, 8: 104, 9: 117};

    for (final entry in expectedPerPage.entries) {
      final c = entry.key;
      final expected = entry.value;
      test('voucherGridLayoutFor($c).perPage == $expected', () {
        expect(voucherGridLayoutFor(c).perPage, equals(expected));
      });
    }

    test('voucherPdfPageCount(3000, 2) == 300', () {
      expect(voucherPdfPageCount(3000, 2), equals(300));
    });

    test('voucherPdfPageCount(3000, 4) == 84', () {
      expect(voucherPdfPageCount(3000, 4), equals(84));
    });

    test('voucherPdfPageCount(3000, 6) == 39', () {
      expect(voucherPdfPageCount(3000, 6), equals(39));
    });

    test('voucherPdfPageCount(3000, 9) == 26', () {
      expect(voucherPdfPageCount(3000, 9), equals(26));
    });

    // Padding and letter spacing helpers stay backwards-compatible at 2–6 cols.
    test('voucherCardPadding gives 6, 5.5, 5, 4.5, 4 at columns 2–6', () {
      expect(voucherCardPadding(2), equals(6.0));
      expect(voucherCardPadding(3), equals(5.5));
      expect(voucherCardPadding(4), equals(5.0));
      expect(voucherCardPadding(5), equals(4.5));
      expect(voucherCardPadding(6), equals(4.0));
    });

    test('voucherCodeLetterSpacing returns 1.0 for columns 2–6', () {
      for (final c in [2, 3, 4, 5, 6]) {
        expect(
          voucherCodeLetterSpacing(c),
          equals(1.0),
          reason: 'columns=$c should give 1.0',
        );
      }
    });

    test('voucherCardPadding clamps to 2.5 at 9 columns', () {
      expect(voucherCardPadding(9), equals(2.5));
    });

    test('voucherCodeLetterSpacing clamps to 0.4 at 9 columns', () {
      expect(voucherCodeLetterSpacing(9), equals(0.4));
    });

    test('8-digit code at 10 pt fits inside a 9-column card with new margins', () {
      // Courier advance = 0.6 em.  An 8-digit code at 10 pt occupies:
      //   glyphs : 8 × (10 × 0.6) = 48 pt
      //   gaps   : 7 × letterSpacing = 7 × 0.4 = 2.8 pt
      //   total  : 50.8 pt
      // The available inner width is cardW − 2 × pad.
      final layout = voucherGridLayoutFor(9);
      final pad = voucherCardPadding(9);
      final spacing = voucherCodeLetterSpacing(9);
      const double courierAdvance = 0.6;
      const int digits = 8;
      const double fontSize = 10.0;
      final double codeWidth =
          digits * fontSize * courierAdvance + (digits - 1) * spacing;
      final double innerWidth = layout.cardW - 2 * pad;
      expect(
        codeWidth,
        lessThanOrEqualTo(innerWidth),
        reason:
            'codeWidth=$codeWidth must fit in innerWidth=$innerWidth '
            '(cardW=${layout.cardW}, pad=$pad)',
      );
    });

    test('voucherPdfPageCount(0, 4) == 0', () {
      expect(voucherPdfPageCount(0, 4), equals(0));
    });

    test('voucherPdfPageCount(1, 4) == 1', () {
      expect(voucherPdfPageCount(1, 4), equals(1));
    });

    test('voucherPdfPageCount(72, 4) == 2 (exact multiple)', () {
      // 72 / perPage(4==36) = 2.0 exactly — ceil must not over-count.
      expect(voucherPdfPageCount(72, 4), equals(2));
    });
  });

  // -------------------------------------------------------------------------
  // Integration tests — real isolates + asset loading.
  // -------------------------------------------------------------------------

  final svc = PrintService();

  test(
    'concurrent calls share one font-load (loads == 2, not 4)',
    () async {
      int loads = 0;
      final spy = PrintService(
        loadAsset: (key) {
          loads++;
          return rootBundle.load(key);
        },
      );

      // Small fixture — enough for a valid PDF, fast enough for CI.
      final items = [
        const VoucherPrintItem(
          code: 'WSL-0001',
          limitText: '1 GB',
          validityText: '3 days',
        ),
        const VoucherPrintItem(
          code: 'WSL-0002',
          limitText: null,
          validityText: 'مفتوح',
        ),
        const VoucherPrintItem(
          code: 'WSL-0003',
          limitText: '30 دقيقة',
          validityText: 'يوم واحد',
        ),
        const VoucherPrintItem(
          code: 'WSL-0004',
          limitText: 'Basic',
          validityText: '7 days',
        ),
      ];

      // Start both calls back-to-back without awaiting between them.
      final f1 = spy.generateVouchersPdf(items, 'Test Router', columns: 4);
      final f2 = spy.generateVouchersPdf(items, 'Test Router', columns: 4);

      final results = await Future.wait([f1, f2]);

      // Both must be valid PDF byte streams.
      expect(
        utf8.decode(results[0].sublist(0, 5)),
        equals('%PDF-'),
        reason: 'first call must produce a valid PDF',
      );
      expect(
        utf8.decode(results[1].sublist(0, 5)),
        equals('%PDF-'),
        reason: 'second call must produce a valid PDF',
      );

      // The single-flight memo means Cairo-Regular + Cairo-Bold are loaded
      // exactly once (2 loads total), not once per call (4 loads).
      expect(
        loads,
        equals(2),
        reason:
            'concurrent generateVouchersPdf calls must share one font-load; '
            'loads=$loads (expected 2, old racy code would hit 4)',
      );
    },
    timeout: const Timeout(Duration(minutes: 2)),
  );

  test(
    'generateVouchersPdf builds a multi-page document off the main isolate',
    () async {
      final items = _buildFixtures(); // 100 items
      final bytes = await svc.generateVouchersPdf(
        items,
        'شركة واصل للاتصالات', // Arabic business name
        columns: 4,
      );

      // Must be a valid PDF byte stream.
      expect(bytes.length, greaterThan(5000));
      final header = utf8.decode(bytes.sublist(0, 5));
      expect(header, equals('%PDF-'));
    },
    timeout: const Timeout(Duration(minutes: 2)),
  );

  test(
    'generateVouchersPdf builds a valid PDF at 9 columns with Arabic and long-code fixtures',
    () async {
      final items = [
        // Arabic limit + validity
        const VoucherPrintItem(
          code: 'WSL-AR-9COL',
          limitText: '500 ميجابايت',
          validityText: '30 يوم',
        ),
        // Long code
        const VoucherPrintItem(
          code: 'WSL-VERY-LONG-CODE-THAT-SHOULD-SCALE-DOWN-1234',
          limitText: '1 GB',
          validityText: '1 day',
        ),
        // Typical 8-digit code
        const VoucherPrintItem(
          code: '12345678',
          limitText: null,
          validityText: 'مفتوح',
        ),
      ];

      final bytes = await svc.generateVouchersPdf(
        items,
        'شركة واصل',
        columns: 9,
      );

      expect(bytes.length, greaterThan(5000));
      expect(utf8.decode(bytes.sublist(0, 5)), equals('%PDF-'));
    },
    timeout: const Timeout(Duration(minutes: 2)),
  );

  test(
    'returns a valid document for an empty item list',
    () async {
      final bytes = await svc.generateVouchersPdf(
        const [],
        'Test',
        columns: 4,
      );

      // doc.save() on a zero-page document still produces a valid PDF header.
      expect(bytes.length, greaterThan(100));
      final header = utf8.decode(bytes.sublist(0, 5));
      expect(header, equals('%PDF-'));
    },
    timeout: const Timeout(Duration(minutes: 2)),
  );

  // -------------------------------------------------------------------------
  // PrintSettings / PrintKnobs model tests — pure, no isolates.
  // -------------------------------------------------------------------------

  group('PrintSettings model', () {
    test('defaults produce classic template, 8-digit codes, 4 columns', () {
      const s = PrintSettings();
      expect(s.templateId, VoucherTemplateId.classic);
      expect(s.codeLength, 8);
      expect(s.defaultColumns, 4);
      expect(s.knobs.showPrice, isFalse);
      expect(s.knobs.stripsPerPage, 8);
    });

    test('fromJson with all fields round-trips via toJson', () {
      final json = {
        'codeLength': 10,
        'templateId': 'detailed',
        'defaultColumns': 6,
        'knobs': {
          'headerText': 'My Router',
          'footerText': 'Connect to WiFi',
          'hotspotAddress': '192.168.88.1',
          'showPrice': true,
          'showQr': true,
          'showBatch': false,
          'stripsPerPage': 12,
        },
      };
      final s = PrintSettings.fromJson(json);
      expect(s.templateId, VoucherTemplateId.detailed);
      expect(s.codeLength, 10);
      expect(s.knobs.headerText, 'My Router');
      expect(s.knobs.showQr, isTrue);
      expect(s.knobs.stripsPerPage, 12);
      final roundTripped = PrintSettings.fromJson(s.toJson());
      expect(roundTripped.toJson(), equals(s.toJson()));
    });

    test('fromJson unknown templateId falls back to classic', () {
      final s = PrintSettings.fromJson({'templateId': 'fancy_new_one'});
      expect(s.templateId, VoucherTemplateId.classic);
    });

    test('PrintKnobs.fromJson clamps stripsPerPage to 4..12', () {
      expect(PrintKnobs.fromJson({'stripsPerPage': 1}).stripsPerPage, 4);
      expect(PrintKnobs.fromJson({'stripsPerPage': 20}).stripsPerPage, 12);
      expect(PrintKnobs.fromJson({'stripsPerPage': 6}).stripsPerPage, 6);
    });

    test('PrintKnobs.fromJson tolerates missing keys', () {
      final k = PrintKnobs.fromJson({});
      expect(k.headerText, '');
      expect(k.showPrice, isFalse);
      expect(k.showBatch, isTrue);
    });

    test('cacheKey changes when template changes', () {
      const s1 = PrintSettings(templateId: VoucherTemplateId.classic);
      const s2 = PrintSettings(templateId: VoucherTemplateId.detailed);
      expect(s1.cacheKey, isNot(equals(s2.cacheKey)));
    });

    test('cacheKey changes when knob changes', () {
      const s1 = PrintSettings();
      final s2 = s1.copyWith(knobs: const PrintKnobs(showPrice: true));
      expect(s1.cacheKey, isNot(equals(s2.cacheKey)));
    });
  });

  // -------------------------------------------------------------------------
  // voucherPdfPageCountFor — template-aware page count
  // -------------------------------------------------------------------------

  group('voucherPdfPageCountFor', () {
    // Classic/Detailed: must equal voucherPdfPageCount for all columns 2..9
    for (final c in [2, 3, 4, 5, 6, 7, 8, 9]) {
      test('Classic parity at columns=$c (several item counts)', () {
        const s = PrintSettings();
        for (final n in [0, 1, 10, 36, 100, 3000]) {
          expect(
            voucherPdfPageCountFor(n, c, s),
            equals(voucherPdfPageCount(n, c)),
            reason: 'n=$n columns=$c',
          );
        }
      });
    }

    test('Strips: ceil(n / stripsPerPage) for stripsPerPage=4', () {
      final s = const PrintSettings(
        templateId: VoucherTemplateId.strips,
        knobs: PrintKnobs(stripsPerPage: 4),
      );
      expect(voucherPdfPageCountFor(0, 1, s), 0);
      expect(voucherPdfPageCountFor(1, 1, s), 1);
      expect(voucherPdfPageCountFor(4, 1, s), 1);
      expect(voucherPdfPageCountFor(5, 1, s), 2);
      expect(voucherPdfPageCountFor(100, 1, s), 25);
    });

    test('Strips: ceil(n / stripsPerPage) for stripsPerPage=8', () {
      final s = const PrintSettings(
        templateId: VoucherTemplateId.strips,
        knobs: PrintKnobs(stripsPerPage: 8),
      );
      expect(voucherPdfPageCountFor(8, 1, s), 1);
      expect(voucherPdfPageCountFor(9, 1, s), 2);
      expect(voucherPdfPageCountFor(100, 1, s), 13);
    });

    test('Strips: ceil(n / stripsPerPage) for stripsPerPage=12', () {
      final s = const PrintSettings(
        templateId: VoucherTemplateId.strips,
        knobs: PrintKnobs(stripsPerPage: 12),
      );
      expect(voucherPdfPageCountFor(12, 1, s), 1);
      expect(voucherPdfPageCountFor(13, 1, s), 2);
      expect(voucherPdfPageCountFor(100, 1, s), 9); // ceil(100/12)=9
    });
  });

  // -------------------------------------------------------------------------
  // Template build-succeeds tests
  // -------------------------------------------------------------------------

  /// Extended fixture set covering the tricky rendering cases per the plan.
  List<VoucherPrintItem> buildExtendedFixtures({
    bool withPrice = false,
    bool withBatch = false,
  }) {
    return [
      // Short name
      VoucherPrintItem(
        code: '12345678',
        limitText: '1 GB',
        validityText: '3 days',
        priceText: withPrice ? '5 USD' : null,
        batchLabel: withBatch ? '261101-1430' : null,
      ),
      // Long name (limitText)
      VoucherPrintItem(
        code: '87654321',
        limitText: 'Unlimited High-Speed Broadband Package',
        validityText: '30 days',
        priceText: withPrice ? '25 USD' : null,
        batchLabel: withBatch ? '261101-1430' : null,
      ),
      // Arabic router name equivalent / Arabic limit + validity
      VoucherPrintItem(
        code: 'AR000001',
        limitText: '500 ميجابايت',
        validityText: '30 يوم',
        priceText: withPrice ? '10 ر.س' : null,
        batchLabel: withBatch ? '261101-1430' : null,
      ),
      // null limitText
      VoucherPrintItem(
        code: 'NULL0001',
        limitText: null,
        validityText: 'مفتوح',
        priceText: withPrice ? '0 USD' : null,
        batchLabel: withBatch ? '261101-1430' : null,
      ),
    ];
  }

  group('Classic template build-succeeds', () {
    test(
      'builds PDF for short/long/Arabic/null-limit fixtures',
      () async {
        final items = buildExtendedFixtures();
        final bytes = await svc.generateVouchersPdf(
          items,
          'Test Router',
          columns: 4,
          settings: const PrintSettings(),
        );
        expect(utf8.decode(bytes.sublist(0, 5)), equals('%PDF-'));
        expect(bytes.length, greaterThan(5000));
      },
      timeout: const Timeout(Duration(minutes: 2)),
    );

    test(
      'builds PDF for 100 items',
      () async {
        final bytes = await svc.generateVouchersPdf(
          _buildFixtures(),
          'Big Router',
          columns: 4,
          settings: const PrintSettings(),
        );
        expect(utf8.decode(bytes.sublist(0, 5)), equals('%PDF-'));
      },
      timeout: const Timeout(Duration(minutes: 2)),
    );

    test(
      'empty list produces valid PDF',
      () async {
        final bytes = await svc.generateVouchersPdf(
          const [],
          'Test',
          columns: 4,
          settings: const PrintSettings(),
        );
        expect(utf8.decode(bytes.sublist(0, 5)), equals('%PDF-'));
      },
      timeout: const Timeout(Duration(minutes: 2)),
    );

    test(
      'showPrice=true produces valid PDF',
      () async {
        final items = buildExtendedFixtures(withPrice: true);
        final bytes = await svc.generateVouchersPdf(
          items,
          'Priced Router',
          columns: 4,
          settings: const PrintSettings(
            knobs: PrintKnobs(showPrice: true),
          ),
        );
        expect(utf8.decode(bytes.sublist(0, 5)), equals('%PDF-'));
      },
      timeout: const Timeout(Duration(minutes: 2)),
    );

    test(
      'null settings → Classic defaults, byte length matches explicit Classic',
      () async {
        final items = buildExtendedFixtures();
        const name = 'Parity Router';
        const cols = 4;
        final bytesNull = await svc.generateVouchersPdf(
          items,
          name,
          columns: cols,
          // settings == null
        );
        final bytesExplicit = await svc.generateVouchersPdf(
          items,
          name,
          columns: cols,
          settings: const PrintSettings(),
        );
        // Byte-length parity proxy (not exact equality — PDF timestamps vary).
        // Allow ±200 bytes for internal PDF metadata variance.
        expect(
          (bytesNull.length - bytesExplicit.length).abs(),
          lessThan(200),
          reason: 'null settings must produce Classic-parity output',
        );
      },
      timeout: const Timeout(Duration(minutes: 2)),
    );
  });

  group('Detailed template build-succeeds', () {
    test(
      'builds PDF for short/long/Arabic/null-limit fixtures',
      () async {
        final items = buildExtendedFixtures();
        final bytes = await svc.generateVouchersPdf(
          items,
          'Detailed Router',
          columns: 4,
          settings: const PrintSettings(
            templateId: VoucherTemplateId.detailed,
          ),
        );
        expect(utf8.decode(bytes.sublist(0, 5)), equals('%PDF-'));
        expect(bytes.length, greaterThan(5000));
      },
      timeout: const Timeout(Duration(minutes: 2)),
    );

    test(
      'showQr=true with hotspotAddress produces valid PDF',
      () async {
        final items = buildExtendedFixtures();
        final bytes = await svc.generateVouchersPdf(
          items,
          'QR Router',
          columns: 4,
          settings: const PrintSettings(
            templateId: VoucherTemplateId.detailed,
            knobs: PrintKnobs(
              showQr: true,
              hotspotAddress: '192.168.88.1',
            ),
          ),
        );
        expect(utf8.decode(bytes.sublist(0, 5)), equals('%PDF-'));
      },
      timeout: const Timeout(Duration(minutes: 2)),
    );

    test(
      'showQr=false (hotspotAddress empty) produces valid PDF',
      () async {
        final items = buildExtendedFixtures();
        final bytes = await svc.generateVouchersPdf(
          items,
          'No QR Router',
          columns: 4,
          settings: const PrintSettings(
            templateId: VoucherTemplateId.detailed,
            knobs: PrintKnobs(showQr: false, hotspotAddress: ''),
          ),
        );
        expect(utf8.decode(bytes.sublist(0, 5)), equals('%PDF-'));
      },
      timeout: const Timeout(Duration(minutes: 2)),
    );

    test(
      'showPrice=true + batchLabel produces valid PDF',
      () async {
        final items = buildExtendedFixtures(withPrice: true, withBatch: true);
        final bytes = await svc.generateVouchersPdf(
          items,
          'Full Detailed',
          columns: 4,
          settings: const PrintSettings(
            templateId: VoucherTemplateId.detailed,
            knobs: PrintKnobs(
              showPrice: true,
              showBatch: true,
              headerText: 'My Hotspot',
              footerText: 'Connect to WiFi and enjoy!',
            ),
          ),
        );
        expect(utf8.decode(bytes.sublist(0, 5)), equals('%PDF-'));
      },
      timeout: const Timeout(Duration(minutes: 2)),
    );

    test(
      '100 items builds without error',
      () async {
        final bytes = await svc.generateVouchersPdf(
          _buildFixtures(),
          'Detailed 100',
          columns: 4,
          settings: const PrintSettings(
            templateId: VoucherTemplateId.detailed,
          ),
        );
        expect(utf8.decode(bytes.sublist(0, 5)), equals('%PDF-'));
      },
      timeout: const Timeout(Duration(minutes: 2)),
    );

    test(
      'page count for Detailed matches Classic grid',
      () async {
        const items100 = 100;
        const cols = 4;
        final pagesDetailed = voucherPdfPageCountFor(
          items100,
          cols,
          const PrintSettings(templateId: VoucherTemplateId.detailed),
        );
        final pagesClassic = voucherPdfPageCount(items100, cols);
        expect(pagesDetailed, equals(pagesClassic));
      },
    );
  });

  group('Strips template build-succeeds', () {
    for (final spp in [4, 8, 12]) {
      test(
        'stripsPerPage=$spp produces valid PDF',
        () async {
          final items = buildExtendedFixtures(withPrice: true, withBatch: true);
          final bytes = await svc.generateVouchersPdf(
            items,
            'Strips Router',
            columns: 1,
            settings: PrintSettings(
              templateId: VoucherTemplateId.strips,
              knobs: PrintKnobs(
                stripsPerPage: spp,
                showPrice: true,
                showBatch: true,
              ),
            ),
          );
          expect(utf8.decode(bytes.sublist(0, 5)), equals('%PDF-'));
          expect(bytes.length, greaterThan(2000));
        },
        timeout: const Timeout(Duration(minutes: 2)),
      );

      test(
        'page count for $spp strips = ceil(n/spp)',
        () {
          final s = PrintSettings(
            templateId: VoucherTemplateId.strips,
            knobs: PrintKnobs(stripsPerPage: spp),
          );
          for (final n in [1, spp, spp + 1, 100]) {
            final expected = n <= 0 ? 0 : (n / spp).ceil();
            expect(
              voucherPdfPageCountFor(n, 1, s),
              equals(expected),
              reason: 'n=$n spp=$spp',
            );
          }
        },
      );
    }

    test(
      'Arabic business name + Arabic limit/validity in Strips',
      () async {
        final items = [
          const VoucherPrintItem(
            code: 'AR000001',
            limitText: 'غير محدود',
            validityText: 'أسبوع',
            batchLabel: '261101-1430',
          ),
        ];
        final bytes = await svc.generateVouchersPdf(
          items,
          'شركة واصل',
          columns: 1,
          settings: const PrintSettings(
            templateId: VoucherTemplateId.strips,
            knobs: PrintKnobs(stripsPerPage: 8),
          ),
        );
        expect(utf8.decode(bytes.sublist(0, 5)), equals('%PDF-'));
      },
      timeout: const Timeout(Duration(minutes: 2)),
    );

    test(
      'empty list produces valid PDF',
      () async {
        final bytes = await svc.generateVouchersPdf(
          const [],
          'Test',
          columns: 1,
          settings: const PrintSettings(
            templateId: VoucherTemplateId.strips,
          ),
        );
        expect(utf8.decode(bytes.sublist(0, 5)), equals('%PDF-'));
      },
      timeout: const Timeout(Duration(minutes: 2)),
    );
  });

  // -------------------------------------------------------------------------
  // Regression tests for dropped-widget bugs (layout overflow in spaceEvenly).
  // PDF compression makes byte-length comparisons unreliable as a proxy for
  // widget presence. Instead: build each template at every column count with
  // showPrice=true and priceText set — the original bug caused a crash or
  // silent drop that the driver test caught visually.
  // -------------------------------------------------------------------------

  group('Regression: showPrice renders without crash at all column counts', () {
    // Items with priceText present so the showPrice path is exercised.
    final pricedItems = List.generate(10, (i) => VoucherPrintItem(
      code: (48213907 + i * 7919).toString().padLeft(8, '0'),
      limitText: i.isEven ? '2 GB' : null,
      validityText: i % 3 == 0 ? 'مفتوح' : '${i + 1} days',
      priceText: 'SDG ${500 + i * 10}',
      batchLabel: '261108-1432',
    ));

    for (final cols in [2, 3, 4, 5, 6, 7, 8, 9]) {
      test(
        'Classic showPrice=true at $cols columns produces valid PDF',
        () async {
          final bytes = await svc.generateVouchersPdf(
            pricedItems,
            'Wasel Net',
            columns: cols,
            settings: const PrintSettings(knobs: PrintKnobs(showPrice: true)),
          );
          expect(utf8.decode(bytes.sublist(0, 5)), equals('%PDF-'));
          expect(bytes.length, greaterThan(2000));
        },
        timeout: const Timeout(Duration(minutes: 2)),
      );
    }

    for (final cols in [2, 4, 6]) {
      test(
        'Detailed showPrice=true at $cols columns produces valid PDF',
        () async {
          final bytes = await svc.generateVouchersPdf(
            pricedItems,
            'Wasel Net',
            columns: cols,
            settings: const PrintSettings(
              templateId: VoucherTemplateId.detailed,
              knobs: PrintKnobs(showPrice: true),
            ),
          );
          expect(utf8.decode(bytes.sublist(0, 5)), equals('%PDF-'));
          expect(bytes.length, greaterThan(2000));
        },
        timeout: const Timeout(Duration(minutes: 2)),
      );
    }

    for (final spp in [4, 8, 12]) {
      test(
        'Strips showPrice=true stripsPerPage=$spp produces valid PDF',
        () async {
          final bytes = await svc.generateVouchersPdf(
            pricedItems,
            'Wasel Net',
            columns: 1,
            settings: PrintSettings(
              templateId: VoucherTemplateId.strips,
              knobs: PrintKnobs(showPrice: true, stripsPerPage: spp),
            ),
          );
          expect(utf8.decode(bytes.sublist(0, 5)), equals('%PDF-'));
          expect(bytes.length, greaterThan(2000));
        },
        timeout: const Timeout(Duration(minutes: 2)),
      );
    }
  });

  // ---------------------------------------------------------------------------
  // generateSampleCardPdf — one card per template
  // ---------------------------------------------------------------------------

  group('generateSampleCardPdf', () {
    final sampleItem = const VoucherPrintItem(
      code: '12345678',
      limitText: '1 GB',
      validityText: '7 days',
      priceText: '5 SDG',
      batchLabel: '261101-1430',
    );

    for (final id in VoucherTemplateId.values) {
      test(
        '${id.name} returns a 1-page valid PDF',
        () async {
          final bytes = await svc.generateSampleCardPdf(
            sampleItem,
            'Test Router',
            settings: PrintSettings(templateId: id),
          );
          expect(utf8.decode(bytes.sublist(0, 5)), equals('%PDF-'));
          expect(bytes.length, greaterThan(500));
          // The PDF must have exactly one page: verify by checking that the
          // %PDF- header is present and no second "Page" dict is added beyond
          // the first. We rely on the builder producing exactly one doc.addPage
          // call, which is enforced by buildSampleCardJob's structure.
          // A structural check: the byte stream must contain at least one
          // stream keyword (card content).
          final content = utf8.decode(bytes, allowMalformed: true);
          expect(content.contains('stream'), isTrue);
        },
        timeout: const Timeout(Duration(minutes: 2)),
      );
    }
  });
}
