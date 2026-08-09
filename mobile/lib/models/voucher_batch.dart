class VoucherBatch {
  final String batchKey;
  final DateTime createdAt;
  final int count;
  final String? limitType;
  final String? limitUnit;
  final int? limitValue;
  final int? validitySeconds;
  final double? price;

  const VoucherBatch({
    required this.batchKey,
    required this.createdAt,
    required this.count,
    this.limitType,
    this.limitUnit,
    this.limitValue,
    this.validitySeconds,
    this.price,
  });

  /// Human-readable limit summary (e.g. "1 hours", "500 MB").
  /// Returns an empty string when no limit data is available.
  /// Uses the same reverse-normalization logic as Voucher.limitDisplayText.
  String get limitDisplayText {
    if (limitType == null || limitValue == null || limitUnit == null) {
      return '';
    }
    int displayValue;
    switch (limitUnit) {
      case 'minutes':
        displayValue = limitValue! ~/ 60;
        break;
      case 'hours':
        displayValue = limitValue! ~/ 3600;
        break;
      case 'days':
        displayValue = limitValue! ~/ 86400;
        break;
      case 'MB':
        displayValue = limitValue! ~/ (1024 * 1024);
        break;
      case 'GB':
        displayValue = limitValue! ~/ (1024 * 1024 * 1024);
        break;
      default:
        displayValue = limitValue!;
    }
    return '$displayValue $limitUnit';
  }

  factory VoucherBatch.fromJson(Map<String, dynamic> json) {
    return VoucherBatch(
      batchKey: json['batchKey'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
      count: json['count'] != null
          ? int.parse(json['count'].toString())
          : 0,
      limitType: json['limitType'] as String?,
      limitUnit: json['limitUnit'] as String?,
      limitValue: json['limitValue'] != null
          ? int.parse(json['limitValue'].toString())
          : null,
      validitySeconds: json['validitySeconds'] != null
          ? int.parse(json['validitySeconds'].toString())
          : null,
      price: json['price'] != null
          ? double.parse(json['price'].toString())
          : null,
    );
  }
}
