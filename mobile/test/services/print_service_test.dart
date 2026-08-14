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
}
