class Subscription {
  final String id;
  final String planTier; // starter, professional, enterprise
  final String planName;
  final String status; // active, expired, cancelled, pending
  final int voucherQuota;
  final int vouchersUsed;
  final int daysRemaining;
  final int maxRouters;
  final DateTime startDate;
  final DateTime endDate;

  const Subscription({
    required this.id,
    required this.planTier,
    required this.planName,
    required this.status,
    required this.voucherQuota,
    this.vouchersUsed = 0,
    required this.daysRemaining,
    required this.maxRouters,
    required this.startDate,
    required this.endDate,
  });

  factory Subscription.fromJson(Map<String, dynamic> json) {
    return Subscription(
      id: json['id'] as String,
      planTier: json['planTier'] as String,
      planName: json['planName'] as String,
      status: json['status'] as String,
      voucherQuota: json['voucherQuota'] as int,
      vouchersUsed: json['vouchersUsed'] as int? ?? 0,
      daysRemaining: json['daysRemaining'] as int? ?? 0,
      maxRouters: json['maxRouters'] as int? ?? 0,
      startDate: DateTime.parse(json['startDate'] as String),
      endDate: DateTime.parse(json['endDate'] as String),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'planTier': planTier,
      'planName': planName,
      'status': status,
      'voucherQuota': voucherQuota,
      'vouchersUsed': vouchersUsed,
      'daysRemaining': daysRemaining,
      'maxRouters': maxRouters,
      'startDate': startDate.toIso8601String(),
      'endDate': endDate.toIso8601String(),
    };
  }

  bool get isActive => status == 'active';
  bool get isPending => status == 'pending';
  bool get isExpired => status == 'expired';

  int get vouchersRemaining =>
      voucherQuota == -1 ? -1 : voucherQuota - vouchersUsed;
}
