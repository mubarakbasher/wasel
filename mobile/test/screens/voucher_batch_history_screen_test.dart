import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/i18n/app_localizations.dart';
import 'package:wasel/models/router_model.dart';
import 'package:wasel/models/voucher_batch.dart';
import 'package:wasel/providers/routers_provider.dart';
import 'package:wasel/providers/voucher_batches_provider.dart';
import 'package:wasel/screens/vouchers/voucher_batch_history_screen.dart';

// ---------------------------------------------------------------------------
// Fake RoutersNotifier
// ---------------------------------------------------------------------------

class _FakeRoutersNotifier extends RoutersNotifier {
  _FakeRoutersNotifier({List<RouterModel> routers = const []}) {
    state = RoutersState(routers: routers);
  }

  @override
  Future<void> loadRouters() async {}
}

// ---------------------------------------------------------------------------
// Fake VoucherBatchesNotifier — seeded via constructor, load() is a no-op
// ---------------------------------------------------------------------------

class _FakeBatchesNotifier extends VoucherBatchesNotifier {
  _FakeBatchesNotifier({List<VoucherBatch> batches = const []}) {
    state = VoucherBatchesState(batches: batches);
  }

  @override
  Future<void> load(String routerId) async {}
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const _kRouterId = 'r-99';
const _kRouterName = 'Test Router';

RouterModel _fakeRouter() => RouterModel(
      id: _kRouterId,
      userId: 'u-1',
      name: _kRouterName,
      status: 'online',
      createdAt: DateTime(2026),
      updatedAt: DateTime(2026),
    );

VoucherBatch _fakeBatch(int offsetDays) => VoucherBatch(
      batchKey: 'batch-$offsetDays',
      createdAt: DateTime(2026, 1, offsetDays + 1),
      count: 10 + offsetDays,
    );

/// Batch with a time limit of 198 000 s = 55 hours, used to verify that the
/// UI renders the localized unit rather than the raw English 'hours' string.
VoucherBatch _fakeBatchWithLimit() => VoucherBatch(
      batchKey: 'batch-limit',
      createdAt: DateTime(2026, 1, 15),
      count: 20,
      limitType: 'time',
      limitValue: 198000, // 55 * 3600
      limitUnit: 'hours',
    );

// ---------------------------------------------------------------------------
// Helper — pumps VoucherBatchHistoryScreen inside a localization + provider
// scope.
// ---------------------------------------------------------------------------

Widget _buildApp({
  required _FakeRoutersNotifier routersNotifier,
  required _FakeBatchesNotifier batchesNotifier,
  Locale? locale,
}) {
  return ProviderScope(
    overrides: [
      routersProvider.overrideWith((ref) => routersNotifier),
      voucherBatchesProvider.overrideWith((ref) => batchesNotifier),
    ],
    child: MaterialApp(
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: const VoucherBatchHistoryScreen(routerId: _kRouterId),
    ),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  group('VoucherBatchHistoryScreen', () {
    testWidgets('shows the router name in the app bar', (tester) async {
      final routersNotifier =
          _FakeRoutersNotifier(routers: [_fakeRouter()]);
      final batchesNotifier = _FakeBatchesNotifier();

      await tester.pumpWidget(_buildApp(
        routersNotifier: routersNotifier,
        batchesNotifier: batchesNotifier,
      ));
      await tester.pump();

      expect(
        find.text(_kRouterName),
        findsOneWidget,
        reason: 'AppBar must show the router name so the user knows which '
            'router the batch history belongs to',
      );
    });

    testWidgets('renders a card per batch', (tester) async {
      final routersNotifier =
          _FakeRoutersNotifier(routers: [_fakeRouter()]);
      final batchesNotifier = _FakeBatchesNotifier(
        batches: [_fakeBatch(0), _fakeBatch(1)],
      );

      await tester.pumpWidget(_buildApp(
        routersNotifier: routersNotifier,
        batchesNotifier: batchesNotifier,
      ));
      await tester.pump();

      // Each batch card shows a batchCount text like "10 vouchers"
      expect(
        find.textContaining('vouchers'),
        findsNWidgets(2),
        reason: 'One batchCount label should appear per batch card',
      );
    });

    testWidgets('empty list shows the empty state naming the router',
        (tester) async {
      final routersNotifier =
          _FakeRoutersNotifier(routers: [_fakeRouter()]);
      final batchesNotifier = _FakeBatchesNotifier(batches: []);

      await tester.pumpWidget(_buildApp(
        routersNotifier: routersNotifier,
        batchesNotifier: batchesNotifier,
      ));
      await tester.pump();

      // The router name appears at least in the empty-state message; the
      // AppBar subtitle also shows it, so we assert at least one match.
      expect(
        find.textContaining(_kRouterName),
        findsAtLeastNWidgets(1),
        reason: 'Empty state message must name the router so the user '
            'understands why no batches appear',
      );
    });

    testWidgets(
        'batch card shows Arabic unit label (ساعات) not raw English "hours"',
        (tester) async {
      // This test MUST fail before the localizedLimitText fix because
      // limitDisplayText hard-codes English unit strings. After the fix it
      // passes because localizedLimitText uses the vouchers.hours i18n key.
      final routersNotifier = _FakeRoutersNotifier(routers: [_fakeRouter()]);
      final batchesNotifier =
          _FakeBatchesNotifier(batches: [_fakeBatchWithLimit()]);

      await tester.pumpWidget(_buildApp(
        routersNotifier: routersNotifier,
        batchesNotifier: batchesNotifier,
        locale: const Locale('ar'),
      ));
      await tester.pump();

      expect(
        find.textContaining('55'),
        findsAtLeastNWidgets(1),
        reason: 'The numeric value 55 must appear in the batch detail line',
      );
      expect(
        find.textContaining('ساعات'),
        findsOneWidget,
        reason:
            'The Arabic translation of "hours" (ساعات) must appear — '
            'not the raw English unit string',
      );
    });
  });
}
