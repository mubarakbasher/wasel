import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/models/card_speed_setting.dart';
import 'package:wasel/providers/card_speed_provider.dart';
import 'package:wasel/services/card_speed_service.dart';

// ---------------------------------------------------------------------------
// Hand-written fake with controllable completers
// ---------------------------------------------------------------------------

class FakeCardSpeedService implements CardSpeedService {
  final _fetchQueue = <Completer<CardSpeedSetting?>>[];
  final _updateQueue = <Completer<CardSpeedSetting>>[];

  int fetchCallCount = 0;
  final updateCalls = <({bool enabled, String speed})>[];

  Completer<CardSpeedSetting?> addFetch() {
    final c = Completer<CardSpeedSetting?>();
    _fetchQueue.add(c);
    return c;
  }

  Completer<CardSpeedSetting> addUpdate() {
    final c = Completer<CardSpeedSetting>();
    _updateQueue.add(c);
    return c;
  }

  @override
  Future<CardSpeedSetting?> fetch() {
    fetchCallCount++;
    if (_fetchQueue.isEmpty) return Future.value(null);
    return _fetchQueue.removeAt(0).future;
  }

  @override
  Future<CardSpeedSetting> update({
    required bool enabled,
    required String speed,
  }) {
    updateCalls.add((enabled: enabled, speed: speed));
    if (_updateQueue.isEmpty) return Future.value(CardSpeedSetting(enabled: enabled, speed: speed));
    return _updateQueue.removeAt(0).future;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const _kDefault = CardSpeedSetting();
const _kOn2M = CardSpeedSetting(enabled: true, speed: '2M');
const _kOn1M = CardSpeedSetting(enabled: true, speed: '1M');

CardSpeedNotifier _make(FakeCardSpeedService svc) =>
    CardSpeedNotifier(service: svc);

void main() {
  late FakeCardSpeedService service;
  late CardSpeedNotifier notifier;

  setUp(() {
    service = FakeCardSpeedService();
    notifier = _make(service);
  });

  group('CardSpeedNotifier', () {
    test('load publishes the fetched setting', () async {
      final c = service.addFetch();
      final future = notifier.load();
      c.complete(const CardSpeedSetting(enabled: false, speed: '2M',
          options: ['1M', '2M']));
      await future;
      expect(notifier.state.setting?.speed, '2M');
      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.error, isNull);
    });

    test('load on 404 sets unavailable and no setting', () async {
      final c = service.addFetch();
      final future = notifier.load();
      c.complete(null); // service returns null for 404
      await future;
      expect(notifier.state.unavailable, isTrue);
      expect(notifier.state.setting, isNull);
    });

    test('load failure sets error and keeps the previous setting', () async {
      // First load succeeds
      final c1 = service.addFetch();
      final f1 = notifier.load();
      c1.complete(_kOn2M);
      await f1;

      // Second load fails
      final c2 = service.addFetch();
      final f2 = notifier.load();
      c2.completeError(Exception('network'));
      await f2;

      expect(notifier.state.setting, _kOn2M);
      expect(notifier.state.error, isNotNull);
    });

    test('save applies optimistically, then the server value', () async {
      // Seed a confirmed value
      final c1 = service.addFetch();
      final f1 = notifier.load();
      c1.complete(_kDefault);
      await f1;

      final cu = service.addUpdate();
      final serverResult = const CardSpeedSetting(enabled: true, speed: '2M',
          options: ['1M', '2M']);
      final fs = notifier.save(enabled: true, speed: '2M');

      // Optimistic apply should have happened
      expect(notifier.state.setting?.enabled, isTrue);

      cu.complete(serverResult);
      await fs;

      expect(notifier.state.setting, serverResult);
    });

    test('save failure rolls back to the last server-confirmed value and sets error',
        () async {
      final c1 = service.addFetch();
      final f1 = notifier.load();
      c1.complete(_kDefault);
      await f1;

      final cu = service.addUpdate();
      final fs = notifier.save(enabled: true, speed: '1M');
      cu.completeError(Exception('server error'));
      await fs;

      expect(notifier.state.setting, _kDefault);
      expect(notifier.state.saveError, isNotNull);
    });

    test('two overlapping failed saves end on the confirmed value, not an optimistic one',
        () async {
      final c1 = service.addFetch();
      final f1 = notifier.load();
      c1.complete(_kDefault); // confirmed: off/2M
      await f1;

      final cu1 = service.addUpdate();
      final cu2 = service.addUpdate();
      final fs1 = notifier.save(enabled: true, speed: '2M');
      final fs2 = notifier.save(enabled: true, speed: '1M');

      cu1.completeError(Exception('fail1'));
      cu2.completeError(Exception('fail2'));
      await Future.wait([fs1, fs2]);

      expect(notifier.state.setting, _kDefault);
    });

    test('saves reach the server in call order', () async {
      final c1 = service.addFetch();
      final f1 = notifier.load();
      c1.complete(_kDefault);
      await f1;

      final cu1 = service.addUpdate();
      final cu2 = service.addUpdate();
      final fs1 = notifier.save(enabled: true, speed: '2M');
      final fs2 = notifier.save(enabled: true, speed: '1M');

      // Let microtasks run so the first save is dispatched.
      await Future.microtask(() {});
      // The first update() must have been called but the second must not yet,
      // because the queue serialises them.
      expect(service.updateCalls, hasLength(1));

      cu1.complete(_kOn2M);
      // Allow the second save to be dispatched.
      await Future.microtask(() {});
      expect(service.updateCalls, hasLength(2));

      cu2.complete(_kOn1M);
      await Future.wait([fs1, fs2]);

      expect(service.updateCalls[0], (enabled: true, speed: '2M'));
      expect(service.updateCalls[1], (enabled: true, speed: '1M'));
      expect(notifier.state.setting, _kOn1M);
    });

    test('a fetch that a save overtook is discarded', () async {
      // Start a load (fetch pending, would return off/2M)
      final cf = service.addFetch();
      final fl = notifier.load();

      // save completes while fetch is in-flight
      final cu = service.addUpdate();
      final fs = notifier.save(enabled: true, speed: '1M');
      cu.complete(_kOn1M);
      await fs;

      // Now the stale fetch completes
      cf.complete(_kDefault); // off/2M
      await fl;

      // Save result should NOT be overwritten by the stale fetch
      expect(notifier.state.setting?.enabled, isTrue);
      expect(notifier.state.setting?.speed, '1M');
    });

    // M5: load() waits for a pending save before fetching
    test('M5 load waits for pending save before fetching', () async {
      // Start a save whose update is still pending.
      final cu = service.addUpdate();
      final fs = notifier.save(enabled: true, speed: '1M');

      // Start load() — it should not call fetch yet (save is still in-flight).
      final cf = service.addFetch();
      final fl = notifier.load();

      // Yield — the load() awaits _saveTail, which is still the pending save.
      await Future.microtask(() {});

      expect(service.fetchCallCount, 0,
          reason: 'fetch must not be called while save is pending');

      // Complete the save, then let the queue drain.
      cu.complete(const CardSpeedSetting(enabled: true, speed: '1M'));
      await fs;
      await Future.microtask(() {});
      await Future.microtask(() {});

      expect(service.fetchCallCount, 1,
          reason: 'fetch must be called once after save completes');

      // Complete the fetch.
      final fetchResult = const CardSpeedSetting(enabled: false, speed: '2M');
      cf.complete(fetchResult);
      await fl;

      expect(notifier.state.setting, fetchResult);
    });

    test('reset clears setting, error and unavailable', () async {
      final c1 = service.addFetch();
      final f1 = notifier.load();
      c1.complete(null); // 404 → unavailable
      await f1;

      expect(notifier.state.unavailable, isTrue);
      notifier.reset();
      expect(notifier.state.setting, isNull);
      expect(notifier.state.error, isNull);
      expect(notifier.state.unavailable, isFalse);
    });

    test('reset during a pending fetch discards the response', () async {
      final cf = service.addFetch();
      final fl = notifier.load();

      // Reset before the fetch resolves.
      notifier.reset();

      // Complete the stale fetch.
      cf.complete(_kOn2M);
      await fl;

      // The stale response must not have been applied.
      expect(notifier.state.setting, isNull);
      expect(notifier.state.isLoading, isFalse);
    });

    test('reset during a pending save discards the response', () async {
      final c1 = service.addFetch();
      final f1 = notifier.load();
      c1.complete(_kDefault);
      await f1;

      final cu = service.addUpdate();
      final fs = notifier.save(enabled: true, speed: '2M');

      // Reset before the update resolves.
      notifier.reset();

      // Yield to let the save coroutine start awaiting cu.future before we
      // complete it, so there is no unhandled-completer-error zone event.
      await Future.microtask(() {});

      // Complete the stale save — the generation check discards the result.
      cu.complete(const CardSpeedSetting(enabled: true, speed: '2M'));
      await fs;

      expect(notifier.state.setting, isNull,
          reason: 'stale save result must not apply after reset');
      expect(notifier.state.saveError, isNull);
    });

    test('save failure sets saveError, load() does not clear it', () async {
      final c1 = service.addFetch();
      final f1 = notifier.load();
      c1.complete(_kDefault);
      await f1;

      final cu = service.addUpdate();
      final fs = notifier.save(enabled: true, speed: '1M');
      cu.completeError(Exception('server error'));
      await fs;

      expect(notifier.state.saveError, isNotNull);

      // load() must NOT clear the save error.
      final c2 = service.addFetch();
      final f2 = notifier.load();
      c2.complete(_kDefault);
      await f2;

      expect(notifier.state.saveError, isNotNull,
          reason: 'saveError must survive a successful load');
    });
  });
}
