class BankInfo {
  final String bankName;
  final String accountNumber;
  final String accountHolder;
  final String instructions;

  const BankInfo({
    required this.bankName,
    required this.accountNumber,
    required this.accountHolder,
    required this.instructions,
  });

  factory BankInfo.fromJson(Map<String, dynamic> json) => BankInfo(
        bankName: (json['bankName'] as String?) ?? '',
        accountNumber: (json['accountNumber'] as String?) ?? '',
        accountHolder: (json['accountHolder'] as String?) ?? '',
        instructions: (json['instructions'] as String?) ?? '',
      );

  bool get isConfigured =>
      bankName.trim().isNotEmpty ||
      accountNumber.trim().isNotEmpty ||
      accountHolder.trim().isNotEmpty;
}
