class ActiveSession {
  final String id;
  final String username;
  final String address;
  final String macAddress;
  final String uptime;
  final int bytesIn;
  final int bytesOut;
  final String idleTime;
  final String loginBy;

  const ActiveSession({
    required this.id,
    required this.username,
    required this.address,
    required this.macAddress,
    required this.uptime,
    required this.bytesIn,
    required this.bytesOut,
    required this.idleTime,
    required this.loginBy,
  });

  String get bytesInDisplay => _formatBytes(bytesIn);
  String get bytesOutDisplay => _formatBytes(bytesOut);

  factory ActiveSession.fromJson(Map<String, dynamic> json) {
    return ActiveSession(
      id: json['id'] as String? ?? '',
      username: json['username'] as String? ?? '',
      address: json['address'] as String? ?? '',
      macAddress: json['macAddress'] as String? ?? '',
      uptime: json['uptime'] as String? ?? '0s',
      bytesIn: json['bytesIn'] as int? ?? 0,
      bytesOut: json['bytesOut'] as int? ?? 0,
      idleTime: json['idleTime'] as String? ?? '0s',
      loginBy: json['loginBy'] as String? ?? '',
    );
  }

  static String _formatBytes(int bytes) {
    if (bytes < 1024) return '${bytes}B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)}KB';
    if (bytes < 1024 * 1024 * 1024) {
      return '${(bytes / (1024 * 1024)).toStringAsFixed(1)}MB';
    }
    return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(2)}GB';
  }
}

class SessionHistory {
  final int id;
  final String sessionId;
  final String uniqueId;
  final String username;
  final String nasIpAddress;
  final DateTime? startTime;
  final DateTime? stopTime;
  final int? sessionTime;
  final int? inputOctets;
  final int? outputOctets;
  final String calledStationId;
  final String callingStationId;
  final String terminateCause;
  final String framedIpAddress;

  const SessionHistory({
    required this.id,
    required this.sessionId,
    required this.uniqueId,
    required this.username,
    required this.nasIpAddress,
    this.startTime,
    this.stopTime,
    this.sessionTime,
    this.inputOctets,
    this.outputOctets,
    required this.calledStationId,
    required this.callingStationId,
    required this.terminateCause,
    required this.framedIpAddress,
  });

  String get sessionTimeDisplay => _formatDuration(sessionTime);
  String get inputDisplay => _formatBytes(inputOctets);
  String get outputDisplay => _formatBytes(outputOctets);

  bool get isActive => stopTime == null;

  factory SessionHistory.fromJson(Map<String, dynamic> json) {
    return SessionHistory(
      id: json['id'] as int,
      sessionId: json['sessionId'] as String? ?? '',
      uniqueId: json['uniqueId'] as String? ?? '',
      username: json['username'] as String? ?? '',
      nasIpAddress: json['nasIpAddress'] as String? ?? '',
      startTime: json['startTime'] != null
          ? DateTime.parse(json['startTime'] as String)
          : null,
      stopTime: json['stopTime'] != null
          ? DateTime.parse(json['stopTime'] as String)
          : null,
      sessionTime: json['sessionTime'] as int?,
      inputOctets: json['inputOctets'] as int?,
      outputOctets: json['outputOctets'] as int?,
      calledStationId: json['calledStationId'] as String? ?? '',
      callingStationId: json['callingStationId'] as String? ?? '',
      terminateCause: json['terminateCause'] as String? ?? '',
      framedIpAddress: json['framedIpAddress'] as String? ?? '',
    );
  }

  static String _formatDuration(int? seconds) {
    if (seconds == null || seconds == 0) return '0s';
    final h = seconds ~/ 3600;
    final m = (seconds % 3600) ~/ 60;
    final s = seconds % 60;
    if (h > 0) return '${h}h ${m}m ${s}s';
    if (m > 0) return '${m}m ${s}s';
    return '${s}s';
  }

  static String _formatBytes(int? bytes) {
    if (bytes == null || bytes == 0) return '0B';
    if (bytes < 1024) return '${bytes}B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)}KB';
    if (bytes < 1024 * 1024 * 1024) {
      return '${(bytes / (1024 * 1024)).toStringAsFixed(1)}MB';
    }
    return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(2)}GB';
  }
}
