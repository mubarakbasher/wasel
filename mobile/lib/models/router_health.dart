enum ProbeStatus {
  pass,
  fail,
  skipped;

  static ProbeStatus fromString(String value) {
    switch (value) {
      case 'pass':
        return ProbeStatus.pass;
      case 'fail':
        return ProbeStatus.fail;
      case 'skipped':
        return ProbeStatus.skipped;
      default:
        return ProbeStatus.skipped;
    }
  }
}

enum OverallHealth {
  healthy,
  degraded,
  broken;

  static OverallHealth fromString(String value) {
    switch (value) {
      case 'healthy':
        return OverallHealth.healthy;
      case 'degraded':
        return OverallHealth.degraded;
      case 'broken':
        return OverallHealth.broken;
      default:
        return OverallHealth.broken;
    }
  }
}

class ProbeResult {
  final String id;
  final String label;
  final ProbeStatus status;
  final String detail;
  final String? remediation;
  final int? setupStep;
  final int durationMs;

  const ProbeResult({
    required this.id,
    required this.label,
    required this.status,
    required this.detail,
    this.remediation,
    this.setupStep,
    required this.durationMs,
  });

  factory ProbeResult.fromJson(Map<String, dynamic> json) {
    return ProbeResult(
      id: json['id'] as String,
      label: json['label'] as String,
      status: ProbeStatus.fromString(json['status'] as String),
      detail: json['detail'] as String? ?? '',
      remediation: json['remediation'] as String?,
      setupStep: json['setupStep'] as int?,
      durationMs: json['durationMs'] as int? ?? 0,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'label': label,
      'status': status.name,
      'detail': detail,
      'remediation': remediation,
      'setupStep': setupStep,
      'durationMs': durationMs,
    };
  }
}

class RouterHealthReport {
  final String routerId;
  final DateTime ranAt;
  final OverallHealth overall;
  final List<ProbeResult> probes;

  const RouterHealthReport({
    required this.routerId,
    required this.ranAt,
    required this.overall,
    required this.probes,
  });

  factory RouterHealthReport.fromJson(Map<String, dynamic> json) {
    final probesList = (json['probes'] as List<dynamic>?)
            ?.map((p) => ProbeResult.fromJson(p as Map<String, dynamic>))
            .toList() ??
        [];
    return RouterHealthReport(
      routerId: json['routerId'] as String,
      ranAt: DateTime.parse(json['ranAt'] as String),
      overall: OverallHealth.fromString(json['overall'] as String),
      probes: probesList,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'routerId': routerId,
      'ranAt': ranAt.toIso8601String(),
      'overall': overall.name,
      'probes': probes.map((p) => p.toJson()).toList(),
    };
  }

  int get passingCount => probes.where((p) => p.status == ProbeStatus.pass).length;
}
