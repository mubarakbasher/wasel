class PaymentRecord {
  final String id;
  final String planTier;
  final String planName;
  final double amount;
  final String currency;
  final String? referenceCode;
  final String? receiptUrl;
  final String status;
  final String? rejectionReason;
  final DateTime? reviewedAt;
  final DateTime createdAt;

  const PaymentRecord({
    required this.id,
    required this.planTier,
    required this.planName,
    required this.amount,
    required this.currency,
    required this.referenceCode,
    required this.receiptUrl,
    required this.status,
    required this.rejectionReason,
    required this.reviewedAt,
    required this.createdAt,
  });

  factory PaymentRecord.fromJson(Map<String, dynamic> json) => PaymentRecord(
        id: json['id'] as String,
        planTier: json['planTier'] as String,
        planName: json['planName'] as String? ?? json['planTier'] as String,
        amount: (json['amount'] as num).toDouble(),
        currency: json['currency'] as String,
        referenceCode: json['referenceCode'] as String?,
        receiptUrl: json['receiptUrl'] as String?,
        status: json['status'] as String,
        rejectionReason: json['rejectionReason'] as String?,
        reviewedAt: json['reviewedAt'] != null
            ? DateTime.parse(json['reviewedAt'] as String)
            : null,
        createdAt: DateTime.parse(json['createdAt'] as String),
      );

  bool get isPending => status == 'pending';
  bool get isApproved => status == 'approved';
  bool get isRejected => status == 'rejected';
  bool get isCancelled => status == 'cancelled';
}
