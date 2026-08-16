package org.hearthchat.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private lateinit var setup: LinearLayout
    private lateinit var urlField: EditText
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        filePathCallback?.onReceiveValue(uris)
        filePathCallback = null
    }

    private val askMic = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        web = findViewById(R.id.web)
        setup = findViewById(R.id.setup)
        urlField = findViewById(R.id.url)
        findViewById<Button>(R.id.connect).setOnClickListener { connect() }

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)

        val s = web.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.databaseEnabled = true
        s.mediaPlaybackRequiresUserGesture = false
        s.javaScriptCanOpenWindowsAutomatically = true
        s.allowFileAccess = true
        s.allowContentAccess = true
        s.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        s.userAgentString = s.userAgentString + " BloodLinkAndroid/0.1"

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val host = request.url.host ?: return false
                val current = Uri.parse(savedUrl()).host
                return if (host != current) {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                    true
                } else false
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO)
                    != PackageManager.PERMISSION_GRANTED
                ) {
                    askMic.launch(Manifest.permission.RECORD_AUDIO)
                }
                request.grant(request.resources)
            }

            override fun onShowFileChooser(
                webView: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                params: FileChooserParams?
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                pickFiles.launch(params?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply { type = "*/*" })
                return true
            }
        }

        val existing = savedUrl()
        if (existing.isNotBlank()) {
            open(existing)
        } else {
            setup.visibility = View.VISIBLE
            web.visibility = View.GONE
        }
    }

    private fun prefs() = getSharedPreferences("hearth", Context.MODE_PRIVATE)
    private fun savedUrl() = prefs().getString("server", "") ?: ""

    private fun connect() {
        var raw = urlField.text.toString().trim()
        if (raw.isEmpty()) {
            Toast.makeText(this, "Enter a server address", Toast.LENGTH_SHORT).show()
            return
        }
        if (!raw.startsWith("http://") && !raw.startsWith("https://")) raw = "http://$raw"
        raw = raw.trimEnd('/')
        prefs().edit().putString("server", raw).apply()
        open(raw)
    }

    private fun open(url: String) {
        setup.visibility = View.GONE
        web.visibility = View.VISIBLE
        web.loadUrl(url)
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menu.add(0, 1, 0, getString(R.string.change_server))
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        if (item.itemId == 1) {
            prefs().edit().remove("server").apply()
            web.loadUrl("about:blank")
            setup.visibility = View.VISIBLE
            web.visibility = View.GONE
            urlField.setText(savedUrl())
            return true
        }
        return super.onOptionsItemSelected(item)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.visibility == View.VISIBLE && web.canGoBack()) web.goBack()
        else super.onBackPressed()
    }
}
