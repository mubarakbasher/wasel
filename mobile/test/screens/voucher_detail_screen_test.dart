import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/i18n/app_localizations.dart';
import 'package:wasel/models/voucher.dart';
import 'package:wasel/providers/vouchers_provider.dart';
import 'package:wasel/screens/vouchers/voucher_detail_screen.dart';
import 'package:wasel/theme/app_theme.dart';

// ---------------------------------------------------------------------------
// Fake notifier — no network, no timer side-effects in state changes
// ---------------------------------------------------------------------------

class _FakeVouchersNotifier extends VouchersNotifier {
  _FakeVouchersNotifier(Voucher? selected)
      : super() {
    state = VouchersState(selectedVoucher: selected);
  }

  @override
  Future<void> loadVoucher(String routerId, String voucherId) async {
    // no-op: state is pre-seeded in constructor
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const _kRouterId = 'r-1';
const _kVoucherId = 'v-1';

/// A UTC datetime that will shift when `.toLocal()` is called on a machine
/// not running UTC.  Tests compute the expected label from `.toLocal()`.
final _kCreatedAtUtc = DateTime.utc(2026, 8, 9, 21, 0, 0);

Voucher _makeVoucher({
  String status = 'active',
  int? validitySeconds,
  DateTime? firstUsedAt,
  DateTime? expiresAt,
  String? expiration,
  String? comment,
  double? price,
  int? simultaneousUse,
}) {
  return Voucher(
    id: _kVoucherId,
    userId: 'u-1',
    routerId: _kRouterId,
    username: 'TEST-001',
    password: 'secret',
    profileName: '3day',
    status: status,
    validitySeconds: validitySeconds,
    firstUsedAt: firstUsedAt,
    expiresAt: expiresAt,
    expiration: expiration,
    comment: comment,
    price: price,
    simultaneousUse: simultaneousUse,
    createdAt: _kCreatedAtUtc,
    updatedAt: _kCreatedAtUtc,
  );
}

// ---------------------------------------------------------------------------
// Helper — pumps the screen inside a full localization + theme stack
// ---------------------------------------------------------------------------

Widget _buildApp(_FakeVouchersNotifier notifier, {Locale? locale}) {
  return ProviderScope(
    overrides: [
      vouchersProvider.overrideWith((ref) => notifier),
    ],
    child: MaterialApp(
      theme: AppTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: const VoucherDetailScreen(
        routerId: _kRouterId,
        voucherId: _kVoucherId,
      ),
    ),
  );
}

String _fmt(DateTime dt) {
  final l = dt.toLocal();
  return '${l.year}-${l.month.toString().padLeft(2, '0')}-'
      '${l.day.toString().padLeft(2, '0')} '
      '${l.hour.toString().padLeft(2, '0')}:${l.minute.toString().padLeft(2, '0')}';
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  // ── Voucher.fromJson / toJson ──────────────────────────────────────────────

  group('Voucher.fromJson / toJson', () {
    final baseJson = {
      'id': 'v-1',
      'userId': 'u-1',
      'routerId': 'r-1',
      'username': 'ABC',
      'status': 'active',
      'createdAt': '2026-08-09T21:00:00.000Z',
      'updatedAt': '2026-08-09T21:00:00.000Z',
    };

    test('new fields absent → both null', () {
      final v = Voucher.fromJson(baseJson);
      expect(v.firstUsedAt, isNull);
      expect(v.expiresAt, isNull);
    });

    test('new fields present → parsed correctly', () {
      final json = {
        ...baseJson,
        'firstUsedAt': '2026-08-10T08:30:00.000Z',
        'expiresAt': '2026-08-12T08:30:00.000Z',
      };
      final v = Voucher.fromJson(json);
      expect(v.firstUsedAt, equals(DateTime.parse('2026-08-10T08:30:00.000Z')));
      expect(v.expiresAt, equals(DateTime.parse('2026-08-12T08:30:00.000Z')));
    });

    test('toJson round-trips the new fields', () {
      final v = Voucher.fromJson({
        ...baseJson,
        'firstUsedAt': '2026-08-10T08:30:00.000Z',
        'expiresAt': '2026-08-12T08:30:00.000Z',
      });
      final json = v.toJson();
      expect(json['firstUsedAt'], isNotNull);
      expect(json['expiresAt'], isNotNull);
    });

    test('toJson with null new fields → null values', () {
      final v = Voucher.fromJson(baseJson);
      final json = v.toJson();
      expect(json['firstUsedAt'], isNull);
      expect(json['expiresAt'], isNull);
    });
  });

  // ── Validity row ───────────────────────────────────────────────────────────

  group('Validity row', () {
    testWidgets('shows localized days in Arabic (3 أيام)', (tester) async {
      final notifier =
          _FakeVouchersNotifier(_makeVoucher(validitySeconds: 3 * 86400));

      await tester.pumpWidget(
          _buildApp(notifier, locale: const Locale('ar')));
      await tester.pump();

      expect(find.textContaining('الصلاحية'), findsOneWidget);
      expect(find.textContaining('أيام'), findsOneWidget,
          reason: 'validity of 3 days must show Arabic days plural');
    });

    testWidgets('shows مفتوح when validitySeconds is null', (tester) async {
      final notifier =
          _FakeVouchersNotifier(_makeVoucher(validitySeconds: null));

      await tester.pumpWidget(
          _buildApp(notifier, locale: const Locale('ar')));
      await tester.pump();

      expect(find.textContaining('مفتوح'), findsOneWidget,
          reason: 'null validity must show مفتوح');
    });
  });

  // ── First-use row ──────────────────────────────────────────────────────────

  group('First-use row', () {
    testWidgets('used card shows formatted firstUsedAt date', (tester) async {
      final firstUsed = DateTime.utc(2026, 8, 10, 8, 30);
      final notifier = _FakeVouchersNotifier(
          _makeVoucher(status: 'active', firstUsedAt: firstUsed));

      await tester.pumpWidget(
          _buildApp(notifier, locale: const Locale('ar')));
      await tester.pump();

      expect(find.textContaining('أول استخدام'), findsOneWidget);
      expect(find.textContaining(_fmt(firstUsed)), findsOneWidget,
          reason: 'first-use date must appear formatted');
    });

    testWidgets('unused card shows لم يُستخدم بعد', (tester) async {
      final notifier = _FakeVouchersNotifier(
          _makeVoucher(status: 'unused', firstUsedAt: null));

      await tester.pumpWidget(
          _buildApp(notifier, locale: const Locale('ar')));
      await tester.pump();

      expect(find.textContaining('لم يُستخدم بعد'), findsOneWidget,
          reason: 'null firstUsedAt must show not-used-yet label');
    });
  });

  // ── Expires row ────────────────────────────────────────────────────────────

  group('Expires row', () {
    testWidgets('hidden when expiration is null', (tester) async {
      final notifier =
          _FakeVouchersNotifier(_makeVoucher(expiration: null, expiresAt: null));

      await tester.pumpWidget(_buildApp(notifier));
      await tester.pump();

      expect(find.textContaining('Expires'), findsNothing,
          reason: 'expires row must be hidden when expiration is null');
    });

    testWidgets('shows formatted expiresAt when set', (tester) async {
      final expiresAt = DateTime.utc(2026, 8, 12, 8, 30);
      final notifier = _FakeVouchersNotifier(_makeVoucher(
        expiration: 'some raw string',
        expiresAt: expiresAt,
      ));

      await tester.pumpWidget(_buildApp(notifier));
      await tester.pump();

      expect(find.textContaining(_fmt(expiresAt)), findsOneWidget,
          reason: 'formatted expiresAt must be shown when available');
      expect(find.textContaining('some raw string'), findsNothing,
          reason: 'raw RADIUS string must not appear when expiresAt is set');
    });

    testWidgets('falls back to raw expiration string when expiresAt is null',
        (tester) async {
      final notifier = _FakeVouchersNotifier(_makeVoucher(
        expiration: 'Nov/01/2026 08:30:00',
        expiresAt: null,
      ));

      await tester.pumpWidget(_buildApp(notifier));
      await tester.pump();

      expect(find.textContaining('Nov/01/2026 08:30:00'), findsOneWidget,
          reason: 'raw expiration must show as fallback when expiresAt absent');
    });
  });

  // ── UTC → local conversion ─────────────────────────────────────────────────

  group('createdAt UTC → local', () {
    testWidgets('createdAt is shown in local time', (tester) async {
      final notifier = _FakeVouchersNotifier(_makeVoucher());

      await tester.pumpWidget(_buildApp(notifier));
      await tester.pump();

      final expected = _fmt(_kCreatedAtUtc);
      expect(find.textContaining(expected), findsOneWidget,
          reason: 'created date must be shown in local time (converted from UTC)');
    });
  });

  // ── 320-wide Arabic layout ─────────────────────────────────────────────────

  group('320-wide Arabic layout', () {
    setUpAll(() async {
      final loader = FontLoader('Cairo');
      for (final weight in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
        loader.addFont(rootBundle.load('assets/fonts/Cairo-$weight.ttf'));
      }
      await loader.load();
    });

    testWidgets(
        'full created date present, no overflow, value Text is LTR',
        (tester) async {
      final notifier = _FakeVouchersNotifier(_makeVoucher());

      tester.view.physicalSize = const Size(320 * 3, 800 * 3);
      tester.view.devicePixelRatio = 3.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
          _buildApp(notifier, locale: const Locale('ar')));
      await tester.pump();

      // No render overflow.
      expect(tester.takeException(), isNull,
          reason: 'must not overflow on 320-wide Arabic screen');

      // The full YYYY-MM-DD HH:mm string must be present (no ellipsis).
      final expected = _fmt(_kCreatedAtUtc);
      expect(find.textContaining(expected), findsOneWidget,
          reason: 'full created date must be visible without truncation');

      // The value Text widget for the created date must have LTR direction.
      final textWidgets = tester
          .widgetList<Text>(find.textContaining(expected))
          .toList();
      expect(
        textWidgets.any((t) => t.textDirection == TextDirection.ltr),
        isTrue,
        reason: 'date value must be TextDirection.ltr to keep digit order in Arabic',
      );
    });
  });
}
