// ---------------------------------------------------------------------------
// Provision status
// ---------------------------------------------------------------------------

enum ProvisionStatus {
  pending,
  inProgress,
  succeeded,
  partial,
  failed;

  static ProvisionStatus? fromString(String? value) {
    switch (value) {
      case 'pending':
        return ProvisionStatus.pending;
      case 'in_progress':
        return ProvisionStatus.inProgress;
      case 'succeeded':
        return ProvisionStatus.succeeded;
      case 'partial':
        return ProvisionStatus.partial;
      case 'failed':
        return ProvisionStatus.failed;
      default:
        return null;
    }
  }
}

class ProvisionStepError {
  final String step;
  final String error;

  const ProvisionStepError({required this.step, required this.error});

  factory ProvisionStepError.fromJson(Map<String, dynamic> json) {
    return ProvisionStepError(
      step: json['step'] as String? ?? '',
      error: json['error'] as String? ?? '',
    );
  }
}

class RouterInterface {
  final String name;
  final String type;
  final bool running;

  const RouterInterface({
    required this.name,
    required this.type,
    required this.running,
  });

  factory RouterInterface.fromJson(Map<String, dynamic> json) {
    return RouterInterface(
      name: json['name'] as String? ?? '',
      type: json['type'] as String? ?? '',
      running: json['running'] as bool? ?? false,
    );
  }
}

// ---------------------------------------------------------------------------
// Probe status
// ---------------------------------------------------------------------------

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
  final ProvisionStatus? provisionStatus;
  final List<ProvisionStepError>? provisionError;
  final DateTime? provisionAppliedAt;
  final bool needsHotspotConfirmation;
  final String? suggestedHotspotInterface;
  final List<RouterInterface> availableInterfaces;

  const RouterHealthReport({
    required this.routerId,
    required this.ranAt,
    required this.overall,
    required this.probes,
    this.provisionStatus,
    this.provisionError,
    this.provisionAppliedAt,
    this.needsHotspotConfirmation = false,
    this.suggestedHotspotInterface,
    this.availableInterfaces = const [],
  });

  factory RouterHealthReport.fromJson(Map<String, dynamic> json) {
    final probesList = (json['probes'] as List<dynamic>?)
            ?.map((p) => ProbeResult.fromJson(p as Map<String, dynamic>))
            .toList() ??
        [];
    final provisionErrorList = (json['provisionError'] as List<dynamic>?)
        ?.map((e) => ProvisionStepError.fromJson(e as Map<String, dynamic>))
        .toList();
    final availableInterfacesList =
        (json['availableInterfaces'] as List<dynamic>?)
                ?.map((i) =>
                    RouterInterface.fromJson(i as Map<String, dynamic>))
                .toList() ??
            [];
    return RouterHealthReport(
      routerId: json['routerId'] as String,
      ranAt: DateTime.parse(json['ranAt'] as String),
      overall: OverallHealth.fromString(json['overall'] as String),
      probes: probesList,
      provisionStatus:
          ProvisionStatus.fromString(json['provisionStatus'] as String?),
      provisionError: provisionErrorList,
      provisionAppliedAt: json['provisionAppliedAt'] != null
          ? DateTime.parse(json['provisionAppliedAt'] as String)
          : null,
      needsHotspotConfirmation:
          json['needsHotspotConfirmation'] as bool? ?? false,
      suggestedHotspotInterface:
          json['suggestedHotspotInterface'] as String?,
      availableInterfaces: availableInterfacesList,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'routerId': routerId,
      'ranAt': ranAt.toIso8601String(),
      'overall': overall.name,
      'probes': probes.map((p) => p.toJson()).toList(),
      'provisionStatus': provisionStatus?.name,
      'provisionError':
          provisionError?.map((e) => {'step': e.step, 'error': e.error}).toList(),
      'provisionAppliedAt': provisionAppliedAt?.toIso8601String(),
      'needsHotspotConfirmation': needsHotspotConfirmation,
      'suggestedHotspotInterface': suggestedHotspotInterface,
    };
  }

  int get passingCount =>
      probes.where((p) => p.status == ProbeStatus.pass).length;
}
