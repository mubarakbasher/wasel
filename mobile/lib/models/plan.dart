class Plan {
  final String tier;
  final String name;
  final double price;
  final String currency;
  final int maxRouters;
  final int monthlyVouchers; // -1 = unlimited
  final String sessionMonitoring;
  final String dashboard;
  final List<String> features;
  final List<int> allowedDurations; // months

  const Plan({
    required this.tier,
    required this.name,
    required this.price,
    required this.currency,
    required this.maxRouters,
    required this.monthlyVouchers,
    required this.sessionMonitoring,
    required this.dashboard,
    required this.features,
    required this.allowedDurations,
  });

  factory Plan.fromJson(Map<String, dynamic> json) {
    return Plan(
      tier: json['tier'] as String,
      name: json['name'] as String,
      price: (json['price'] as num).toDouble(),
      currency: json['currency'] as String,
      maxRouters: json['maxRouters'] as int,
      monthlyVouchers: json['monthlyVouchers'] as int,
      sessionMonitoring: json['sessionMonitoring'] as String,
      dashboard: json['dashboard'] as String,
      features: (json['features'] as List<dynamic>)
          .map((e) => e as String)
          .toList(),
      allowedDurations: json['allowedDurations'] != null
          ? (json['allowedDurations'] as List<dynamic>)
              .map((e) => e as int)
              .toList()
          : [1],
    );
  }

  bool get isUnlimitedVouchers => monthlyVouchers == -1;

  bool get hasMultipleDurations => allowedDurations.length > 1;

  String priceLabel(String symbol) => '$symbol ${price.toStringAsFixed(0)}';

  String totalPriceLabel(String symbol, int months) =>
      '$symbol ${(price * months).toStringAsFixed(0)}';
}
