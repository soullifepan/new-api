package setting

// Alipay Native Face-to-Face payment settings. Credentials are intentionally
// separate from other payment providers so sandbox and production cannot share
// an order namespace.
var (
	AlipayNativeEnabled    bool
	AlipayNativeAppID      string
	AlipayNativeSellerID   string
	AlipayNativePrivateKey string
	AlipayNativePublicKey  string
	AlipayNativeAppCert    string
	AlipayNativeAlipayCert string
	AlipayNativeRootCert   string
	AlipayNativeSandbox    bool
	AlipayNativeUnitPrice  float64 = 1
	AlipayNativeMinTopUp   int     = 1
)
