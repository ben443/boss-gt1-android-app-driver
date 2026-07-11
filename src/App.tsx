import React, { useState } from 'react';
import { Copy, Check, Terminal, FileCode2 } from 'lucide-react';

const androidManifest = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.example.bossgt1usb">

    <uses-feature android:name="android.hardware.usb.host" />
    <uses-permission android:name="android.permission.USB_PERMISSION" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="GT-1 Controller"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/Theme.BossGT1USB">
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:label="GT-1 Controller"
            android:theme="@style/Theme.BossGT1USB">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

            <!-- Listen for USB attachment -->
            <intent-filter>
                <action android:name="android.hardware.usb.action.USB_DEVICE_ATTACHED" />
            </intent-filter>
            <meta-data
                android:name="android.hardware.usb.action.USB_DEVICE_ATTACHED"
                android:resource="@xml/device_filter" />
        </activity>
    </application>

</manifest>`;

const mainActivity = `package com.example.bossgt1usb

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat

private const val ACTION_USB_PERMISSION = "com.example.bossgt1usb.USB_PERMISSION"
private const val ROLAND_VENDOR_ID = 0x0582

class MainActivity : ComponentActivity() {

    private lateinit var usbManager: UsbManager
    private var usbConnection: UsbDeviceConnection? = null
    private var usbEndpointOut: UsbEndpoint? = null
    private var isConnected by mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        usbManager = getSystemService(Context.USB_SERVICE) as UsbManager

        setContent {
            MaterialTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    GT1ControllerScreen(
                        isConnected = isConnected,
                        onConnectClick = { setupUsb() },
                        onGainChange = { gain -> sendPreampGain(gain) }
                    )
                }
            }
        }
    }

    private fun setupUsb() {
        val deviceList = usbManager.deviceList
        val gt1Device = deviceList.values.find { it.vendorId == ROLAND_VENDOR_ID }

        if (gt1Device != null) {
            val permissionIntent = PendingIntent.getBroadcast(
                this, 0, Intent(ACTION_USB_PERMISSION),
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
            )
            
            val filter = IntentFilter(ACTION_USB_PERMISSION)
            ContextCompat.registerReceiver(
                this,
                usbReceiver,
                filter,
                ContextCompat.RECEIVER_NOT_EXPORTED
            )

            usbManager.requestPermission(gt1Device, permissionIntent)
        } else {
            Toast.makeText(this, "Boss GT-1 not found", Toast.LENGTH_SHORT).show()
        }
    }

    private val usbReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (ACTION_USB_PERMISSION == intent.action) {
                synchronized(this) {
                    val device: UsbDevice? = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
                    if (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) {
                        device?.let { connectToDevice(it) }
                    } else {
                        Toast.makeText(context, "Permission denied", Toast.LENGTH_SHORT).show()
                    }
                }
                context.unregisterReceiver(this)
            }
        }
    }

    private fun connectToDevice(device: UsbDevice) {
        var midiInterface: UsbInterface? = null
        for (i in 0 until device.interfaceCount) {
            val intf = device.getInterface(i)
            var hasIn = false
            var hasOut = false
            for (j in 0 until intf.endpointCount) {
                val ep = intf.getEndpoint(j)
                if (ep.type == UsbConstants.USB_ENDPOINT_XFER_BULK) {
                    if (ep.direction == UsbConstants.USB_DIR_IN) hasIn = true
                    if (ep.direction == UsbConstants.USB_DIR_OUT) hasOut = true
                }
            }
            if (hasIn && hasOut) {
                midiInterface = intf
                break
            }
        }

        if (midiInterface == null) {
            Toast.makeText(this, "MIDI Interface not found", Toast.LENGTH_SHORT).show()
            return
        }

        usbConnection = usbManager.openDevice(device)
        if (usbConnection?.claimInterface(midiInterface, true) == true) {
            for (i in 0 until midiInterface.endpointCount) {
                val ep = midiInterface.getEndpoint(i)
                if (ep.type == UsbConstants.USB_ENDPOINT_XFER_BULK && ep.direction == UsbConstants.USB_DIR_OUT) {
                    usbEndpointOut = ep
                    break
                }
            }
            isConnected = true
            Toast.makeText(this, "Connected to GT-1", Toast.LENGTH_SHORT).show()
        } else {
            Toast.makeText(this, "Could not claim interface", Toast.LENGTH_SHORT).show()
        }
    }

    private fun sendPreampGain(gain: Int) {
        // Boss GT-1 Preamp Gain Address: 0x60 0x00 0x00 0x18 (Example)
        val address = byteArrayOf(0x60, 0x00, 0x00, 0x18)
        val data = byteArrayOf(gain.toByte())
        val sysEx = createRolandSysEx(address, data)
        sendMidiMessage(sysEx)
    }

    private fun createRolandSysEx(address: ByteArray, data: ByteArray): ByteArray {
        val deviceId: Byte = 0x10
        // GT-1 Model ID: 0x00 0x00 0x00 0x30
        val modelId = byteArrayOf(0x00, 0x00, 0x00, 0x30)
        val commandId: Byte = 0x12 // DT1 (Data Set 1)

        val message = mutableListOf<Byte>()
        message.add(0xF0.toByte()) // SysEx Start
        message.add(0x41.toByte()) // Roland ID
        message.add(deviceId)
        message.addAll(modelId.toList())
        message.add(commandId)
        
        val payload = mutableListOf<Byte>()
        payload.addAll(address.toList())
        payload.addAll(data.toList())
        
        message.addAll(payload)
        
        // Roland Checksum calculation
        var sum = 0
        for (b in payload) {
            sum += b.toInt() and 0x7F
        }
        val checksum = (128 - (sum % 128)) and 0x7F
        message.add(checksum.toByte())
        
        message.add(0xF7.toByte()) // SysEx End
        
        return message.toByteArray()
    }

    private fun sendMidiMessage(sysEx: ByteArray) {
        val conn = usbConnection ?: return
        val ep = usbEndpointOut ?: return

        // Format into 4-byte USB MIDI packets
        val usbMidiData = mutableListOf<Byte>()
        var i = 0
        while (i < sysEx.size) {
            val remaining = sysEx.size - i
            val packet = ByteArray(4) { 0 }
            
            when {
                i == 0 -> {
                    packet[0] = 0x04 // CIN 4: SysEx starts or continues
                    packet[1] = sysEx[i]
                    packet[2] = sysEx[i+1]
                    packet[3] = sysEx[i+2]
                    i += 3
                }
                remaining >= 3 && sysEx[i+2] != 0xF7.toByte() -> {
                    packet[0] = 0x04
                    packet[1] = sysEx[i]
                    packet[2] = sysEx[i+1]
                    packet[3] = sysEx[i+2]
                    i += 3
                }
                remaining == 3 -> {
                    packet[0] = 0x07 // CIN 7: SysEx ends with 3 bytes
                    packet[1] = sysEx[i]
                    packet[2] = sysEx[i+1]
                    packet[3] = sysEx[i+2]
                    i += 3
                }
                remaining == 2 -> {
                    packet[0] = 0x06 // CIN 6: SysEx ends with 2 bytes
                    packet[1] = sysEx[i]
                    packet[2] = sysEx[i+1]
                    packet[3] = 0x00
                    i += 2
                }
                remaining == 1 -> {
                    packet[0] = 0x05 // CIN 5: SysEx ends with 1 byte
                    packet[1] = sysEx[i]
                    packet[2] = 0x00
                    packet[3] = 0x00
                    i += 1
                }
            }
            usbMidiData.addAll(packet.toList())
        }
        
        val dataToSend = usbMidiData.toByteArray()
        val timeout = 1000
        conn.bulkTransfer(ep, dataToSend, dataToSend.size, timeout)
    }

    override fun onDestroy() {
        super.onDestroy()
        usbConnection?.close()
    }
}

@Composable
fun GT1ControllerScreen(
    isConnected: Boolean,
    onConnectClick: () -> Unit,
    onGainChange: (Int) -> Unit
) {
    var gainValue by remember { mutableFloatStateOf(50f) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Button(
            onClick = onConnectClick,
            enabled = !isConnected
        ) {
            Text(if (isConnected) "Connected to GT-1" else "Connect USB")
        }
        
        Text(
            text = "Preamp Gain: " + gainValue.toInt().toString(),
            modifier = Modifier.padding(top = 32.dp, bottom = 16.dp)
        )
        
        Slider(
            value = gainValue,
            onValueChange = { 
                gainValue = it
                if (isConnected) {
                    onGainChange(it.toInt())
                }
            },
            valueRange = 0f..120f,
            steps = 120,
            enabled = isConnected
        )
    }
}`;

const deviceFilter = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- Roland Vendor ID: 0x0582 (1410) -->
    <usb-device vendor-id="1410" />
</resources>`;

function CodeBlock({ filename, code, language }: { filename: string, code: string, language: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mb-8 p-6 bg-slate-900/40 rounded-3xl border border-white/5 backdrop-blur-sm shadow-xl overflow-hidden">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-slate-400 uppercase tracking-widest">
          <FileCode2 className="w-4 h-4" />
          <span className="text-[10px] font-medium font-sans">{filename}</span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-white/10 hover:bg-white/20 border border-white/10 rounded-full transition-all"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="overflow-x-auto">
        <pre className="text-sm font-mono text-emerald-400 opacity-80 space-y-1">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <div 
      className="min-h-screen w-full flex flex-col font-sans text-slate-200 overflow-hidden" 
      style={{ background: 'radial-gradient(circle at top left, #1a1c2c, #0a0b10)' }}
    >
      <header className="flex items-center justify-between px-8 py-6 bg-white/5 border-b border-white/10 backdrop-blur-xl">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Terminal className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">GT-1 Driver Studio</h1>
            <p className="text-xs text-slate-400 font-mono">com.roland.boss.gt1.controller</p>
          </div>
        </div>
        
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">USB Protocol</span>
            <span className="text-sm font-mono text-blue-400">v2.0 HID/MIDI Bulk</span>
          </div>
        </div>
      </header>

      <main className="flex-1 flex p-8 gap-8 overflow-y-auto">
        <div className="max-w-4xl mx-auto w-full flex flex-col gap-8">
          <div className="flex-1 p-10 bg-white/5 rounded-[40px] border border-white/10 backdrop-blur-2xl relative overflow-hidden">
            <div className="absolute -top-24 -right-24 w-64 h-64 bg-blue-500/20 rounded-full blur-[100px]"></div>
            
            <div className="relative z-10">
              <h3 className="text-3xl font-light text-white mb-2">Android USB Host</h3>
              <p className="text-slate-400 mb-12">
                Since this is a web-based environment, I have generated the native Android Kotlin code and manifest files you requested below. You can copy these files directly into your Android Studio project to build and compile the APK.
              </p>

              <CodeBlock 
                filename="MainActivity.kt" 
                code={mainActivity} 
                language="kotlin" 
              />
              
              <CodeBlock 
                filename="AndroidManifest.xml" 
                code={androidManifest} 
                language="xml" 
              />
              
              <CodeBlock 
                filename="res/xml/device_filter.xml" 
                code={deviceFilter} 
                language="xml" 
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
