/// A stale-build sentinel thrown by [SerialBuildCache] when a queued request
/// is superseded before — or immediately after — its build completes.
///
/// The exception is intentional and harmless: `printing`'s PdfPreview treats a
/// throwing build as an error state *only if the widget is still mounted*
/// (FlutterError.reportError + error card). Because a stale request is always
/// paired with a newer incarnation that is still mounted, the throw is caught
/// and discarded by the package before any error UI appears.
class StaleBuildException implements Exception {
  final String message;
  const StaleBuildException([this.message = 'build superseded']);

  @override
  String toString() =>
      'StaleBuildException: $message (expected during rapid UI changes; harmless)';
}

/// FIFO-serializes async builds (at most one `build` in flight) and caches
/// the last successful result by key.
///
/// ### Usage
/// ```dart
/// final _cache = SerialBuildCache<int, Uint8List>();
///
/// Future<Uint8List> _generatePdf(PdfPageFormat format) {
///   final columns = _previewColumns;
///   final generation = _generation;
///   return _cache.enqueue(
///     key: columns,
///     isStale: () => !mounted || generation != _generation,
///     build: () => service.generate(columns),
///   );
/// }
/// ```
///
/// ### Guarantees
/// - At most one `build` callback is executing at any moment (FIFO queue).
/// - If [isStale] returns `true` at dequeue time the request rejects
///   immediately with [StaleBuildException] *without* invoking [build].
/// - [build] is not invoked when [key] matches the cached key (cache hit).
/// - The cached value is written *before* the post-build [isStale] check, so
///   even a stale-after-build request populates the cache for the next caller
///   with the same key.
/// - A [build] error propagates to the caller but does not poison the queue;
///   the next enqueued request starts normally.
class SerialBuildCache<K, V> {
  Future<void> _tail = Future<void>.value();
  K? _cachedKey;
  V? _cachedValue;

  /// Enqueues an async build and returns a [Future] that resolves with either
  /// the cached result or the newly built value.
  ///
  /// [key] identifies the build artefact for cache lookup.
  /// [isStale] is probed at dequeue time AND again after [build] completes;
  ///   returning `true` at either point causes the future to reject with
  ///   [StaleBuildException].
  /// [build] is called only when [isStale] is false AND there is no cache hit.
  Future<V> enqueue({
    required K key,
    required bool Function() isStale,
    required Future<V> Function() build,
  }) {
    final result = _tail.then((_) async {
      if (isStale()) throw const StaleBuildException('stale at dequeue');
      final cached = _cachedValue;
      if (cached != null && _cachedKey == key) return cached;
      final value = await build();
      _cachedKey = key; // cache BEFORE the post-build stale check so a
      _cachedValue = value; // queued successor with the same key cache-hits
      if (isStale()) throw const StaleBuildException('stale after build');
      return value;
    });
    // Chain the tail so queue stays healthy regardless of success or error.
    _tail = result.then<void>((_) {}, onError: (Object _) {});
    return result;
  }
}
