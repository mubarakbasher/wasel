class ReportRequest {
  final String type;
  final DateTime startDate;
  final DateTime endDate;
  final String? routerId;

  const ReportRequest({
    required this.type,
    required this.startDate,
    required this.endDate,
    this.routerId,
  });

  Map<String, String> toQueryParams() {
    return {
      'type': type,
      'startDate': startDate.toIso8601String().split('T').first,
      'endDate': endDate.toIso8601String().split('T').first,
      if (routerId != null) 'routerId': routerId!,
    };
  }
}

class VoucherSalesReport {
  final int totalCreated;
  final int totalUsed;
  final int totalExpired;
  final int totalActive;
  final List<DailyVoucherStat> dailyStats;

  const VoucherSalesReport({
    required this.totalCreated,
    required this.totalUsed,
    required this.totalExpired,
    required this.totalActive,
    required this.dailyStats,
  });

  factory VoucherSalesReport.fromJson(Map<String, dynamic> json) {
    return VoucherSalesReport(
      totalCreated: json['totalCreated'] as int? ?? 0,
      totalUsed: json['totalUsed'] as int? ?? 0,
      totalExpired: json['totalExpired'] as int? ?? 0,
      totalActive: json['totalActive'] as int? ?? 0,
      dailyStats: (json['dailyStats'] as List?)
              ?.map(
                  (e) => DailyVoucherStat.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
    );
  }
}

class DailyVoucherStat {
  final String date;
  final int created;
  final int used;
  final int expired;

  const DailyVoucherStat({
    required this.date,
    required this.created,
    required this.used,
    required this.expired,
  });

  factory DailyVoucherStat.fromJson(Map<String, dynamic> json) {
    return DailyVoucherStat(
      date: json['date'] as String? ?? '',
      created: json['created'] as int? ?? 0,
      used: json['used'] as int? ?? 0,
      expired: json['expired'] as int? ?? 0,
    );
  }
}

class SessionReport {
  final int totalSessions;
  final double avgDuration;
  final int totalDataIn;
  final int totalDataOut;
  final List<DailySessionStat> dailyStats;

  const SessionReport({
    required this.totalSessions,
    required this.avgDuration,
    required this.totalDataIn,
    required this.totalDataOut,
    required this.dailyStats,
  });

  String get avgDurationDisplay => _formatDuration(avgDuration.round());
  String get totalDataInDisplay => _formatBytes(totalDataIn);
  String get totalDataOutDisplay => _formatBytes(totalDataOut);
  String get totalDataDisplay =>
      _formatBytes(totalDataIn + totalDataOut);

  factory SessionReport.fromJson(Map<String, dynamic> json) {
    return SessionReport(
      totalSessions: json['totalSessions'] as int? ?? 0,
      avgDuration: (json['avgDuration'] as num?)?.toDouble() ?? 0.0,
      totalDataIn: json['totalDataIn'] as int? ?? 0,
      totalDataOut: json['totalDataOut'] as int? ?? 0,
      dailyStats: (json['dailyStats'] as List?)
              ?.map(
                  (e) => DailySessionStat.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
    );
  }

  static String _formatDuration(int seconds) {
    if (seconds == 0) return '0s';
    final h = seconds ~/ 3600;
    final m = (seconds % 3600) ~/ 60;
    final s = seconds % 60;
    if (h > 0) return '${h}h ${m}m ${s}s';
    if (m > 0) return '${m}m ${s}s';
    return '${s}s';
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

class DailySessionStat {
  final String date;
  final int sessions;
  final double avgDuration;
  final int dataIn;
  final int dataOut;

  const DailySessionStat({
    required this.date,
    required this.sessions,
    required this.avgDuration,
    required this.dataIn,
    required this.dataOut,
  });

  String get avgDurationDisplay =>
      SessionReport._formatDuration(avgDuration.round());
  String get dataInDisplay => SessionReport._formatBytes(dataIn);
  String get dataOutDisplay => SessionReport._formatBytes(dataOut);

  factory DailySessionStat.fromJson(Map<String, dynamic> json) {
    return DailySessionStat(
      date: json['date'] as String? ?? '',
      sessions: json['sessions'] as int? ?? 0,
      avgDuration: (json['avgDuration'] as num?)?.toDouble() ?? 0.0,
      dataIn: json['dataIn'] as int? ?? 0,
      dataOut: json['dataOut'] as int? ?? 0,
    );
  }
}

class RevenueReport {
  final int totalVouchers;
  final Map<String, ProfileRevenue> byProfile;
  final List<DailyRevenueStat> dailyStats;

  const RevenueReport({
    required this.totalVouchers,
    required this.byProfile,
    required this.dailyStats,
  });

  factory RevenueReport.fromJson(Map<String, dynamic> json) {
    final byProfileJson =
        json['byProfile'] as Map<String, dynamic>? ?? {};
    final byProfile = byProfileJson.map(
      (key, value) => MapEntry(
        key,
        ProfileRevenue.fromJson(value as Map<String, dynamic>),
      ),
    );
    return RevenueReport(
      totalVouchers: json['totalVouchers'] as int? ?? 0,
      byProfile: byProfile,
      dailyStats: (json['dailyStats'] as List?)
              ?.map(
                  (e) => DailyRevenueStat.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
    );
  }
}

class ProfileRevenue {
  final String profileName;
  final int voucherCount;

  const ProfileRevenue({
    required this.profileName,
    required this.voucherCount,
  });

  factory ProfileRevenue.fromJson(Map<String, dynamic> json) {
    return ProfileRevenue(
      profileName: json['profileName'] as String? ?? '',
      voucherCount: json['voucherCount'] as int? ?? 0,
    );
  }
}

class DailyRevenueStat {
  final String date;
  final int vouchersCreated;

  const DailyRevenueStat({
    required this.date,
    required this.vouchersCreated,
  });

  factory DailyRevenueStat.fromJson(Map<String, dynamic> json) {
    return DailyRevenueStat(
      date: json['date'] as String? ?? '',
      vouchersCreated: json['vouchersCreated'] as int? ?? 0,
    );
  }
}

class RouterUptimeReport {
  final List<RouterUptime> routers;

  const RouterUptimeReport({
    required this.routers,
  });

  factory RouterUptimeReport.fromJson(Map<String, dynamic> json) {
    return RouterUptimeReport(
      routers: (json['routers'] as List?)
              ?.map((e) => RouterUptime.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
    );
  }
}

class RouterUptime {
  final String routerId;
  final String routerName;
  final double uptimePercentage;
  final String currentStatus;

  const RouterUptime({
    required this.routerId,
    required this.routerName,
    required this.uptimePercentage,
    required this.currentStatus,
  });

  factory RouterUptime.fromJson(Map<String, dynamic> json) {
    return RouterUptime(
      routerId: json['routerId'] as String? ?? '',
      routerName: json['routerName'] as String? ?? '',
      uptimePercentage:
          (json['uptimePercentage'] as num?)?.toDouble() ?? 0.0,
      currentStatus: json['currentStatus'] as String? ?? 'unknown',
    );
  }
}
