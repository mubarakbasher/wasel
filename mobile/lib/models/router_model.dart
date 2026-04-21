import 'router_health.dart';

class RouterModel {
  final String id;
  final String userId;
  final String name;
  final String? model;
  final String? rosVersion;
  final String? apiUser;
  final String? wgPublicKey;
  final String? tunnelIp;
  final String? nasIdentifier;
  final String status; // online, offline, degraded
  final DateTime? lastSeen;
  final DateTime createdAt;
  final DateTime updatedAt;
  final RouterHealthReport? lastHealthReport;
  final DateTime? lastHealthCheckAt;

  const RouterModel({
    required this.id,
    required this.userId,
    required this.name,
    this.model,
    this.rosVersion,
    this.apiUser,
    this.wgPublicKey,
    this.tunnelIp,
    this.nasIdentifier,
    this.status = 'offline',
    this.lastSeen,
    required this.createdAt,
    required this.updatedAt,
    this.lastHealthReport,
    this.lastHealthCheckAt,
  });

  bool get isOnline => status == 'online';
  bool get isOffline => status == 'offline';
  bool get isDegraded => status == 'degraded';

  factory RouterModel.fromJson(Map<String, dynamic> json) {
    return RouterModel(
      id: json['id'] as String,
      userId: json['userId'] as String,
      name: json['name'] as String,
      model: json['model'] as String?,
      rosVersion: json['rosVersion'] as String?,
      apiUser: json['apiUser'] as String?,
      wgPublicKey: json['wgPublicKey'] as String?,
      tunnelIp: json['tunnelIp'] as String?,
      nasIdentifier: json['nasIdentifier'] as String?,
      status: json['status'] as String? ?? 'offline',
      lastSeen: json['lastSeen'] != null
          ? DateTime.parse(json['lastSeen'] as String)
          : null,
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
      lastHealthReport: json['lastHealthReport'] != null
          ? RouterHealthReport.fromJson(
              json['lastHealthReport'] as Map<String, dynamic>)
          : null,
      lastHealthCheckAt: json['lastHealthCheckAt'] != null
          ? DateTime.parse(json['lastHealthCheckAt'] as String)
          : null,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'userId': userId,
      'name': name,
      'model': model,
      'rosVersion': rosVersion,
      'apiUser': apiUser,
      'wgPublicKey': wgPublicKey,
      'tunnelIp': tunnelIp,
      'nasIdentifier': nasIdentifier,
      'status': status,
      'lastSeen': lastSeen?.toIso8601String(),
      'createdAt': createdAt.toIso8601String(),
      'updatedAt': updatedAt.toIso8601String(),
      'lastHealthReport': lastHealthReport?.toJson(),
      'lastHealthCheckAt': lastHealthCheckAt?.toIso8601String(),
    };
  }
}
