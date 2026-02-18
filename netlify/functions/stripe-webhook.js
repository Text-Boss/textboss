{
  "id": "evt_1T1tcWJLW3xIuv3LpYMoG2Fy",
  "object": "event",
  "api_version": "2026-01-28.clover",
  "created": 1771355259,
  "data": {
    "object": {
      "id": "cs_test_a1a96dBK570Ytggr4uBqDf5Sddj2A17giQONkeDPyUHDk77wTSiw9chcz2",
      "object": "checkout.session",
      "adaptive_pricing": {
        "enabled": true
      },
      "after_expiration": null,
      "allow_promotion_codes": false,
      "amount_subtotal": 7900,
      "amount_total": 7900,
      "automatic_tax": {
        "enabled": false,
        "liability": null,
        "provider": null,
        "status": null
      },
      "billing_address_collection": "auto",
      "cancel_url": "https://stripe.com",
      "client_reference_id": null,
      "client_secret": null,
      "collected_information": {
        "business_name": null,
        "individual_name": null,
        "shipping_details": null
      },
      "consent": null,
      "consent_collection": {
        "payment_method_reuse_agreement": null,
        "promotions": "none",
        "terms_of_service": "none"
      },
      "created": 1771355209,
      "currency": "aud",
      "currency_conversion": null,
      "custom_fields": [],
      "custom_text": {
        "after_submit": null,
        "shipping_address": null,
        "submit": null,
        "terms_of_service_acceptance": null
      },
      "customer": "cus_TztPy37LgjCfge",
      "customer_account": null,
      "customer_creation": "if_required",
      "customer_details": {
        "address": {
          "city": null,
          "country": "AU",
          "line1": null,
          "line2": null,
          "postal_code": null,
          "state": null
        },
        "business_name": null,
        "email": "a.zora-lee@hotmail.com",
        "individual_name": null,
        "name": "Adele Leksas",
        "phone": null,
        "tax_exempt": "none",
        "tax_ids": []
      },
      "customer_email": null,
      "discounts": [],
      "expires_at": 1771441609,
      "invoice": "in_1T1tcRJLW3xIuv3Ley15H9wy",
      "invoice_creation": null,
      "livemode": false,
      "locale": "auto",
      "metadata": {},
      "mode": "subscription",
      "origin_context": null,
      "payment_intent": null,
      "payment_link": "plink_1Sy2dOJLW3xIuv3LaExaQoXu",
      "payment_method_collection": "always",
      "payment_method_configuration_details": {
        "id": "pmc_1SvunwJLW3xIuv3Lzmascv4p",
        "parent": null
      },
      "payment_method_options": {
        "card": {
          "request_three_d_secure": "automatic"
        }
      },
      "payment_method_types": [
        "card",
        "klarna",
        "link"
      ],
      "payment_status": "paid",
      "permissions": null,
      "phone_number_collection": {
        "enabled": false
      },
      "recovered_from": null,
      "saved_payment_method_options": {
        "allow_redisplay_filters": [
          "always"
        ],
        "payment_method_remove": "disabled",
        "payment_method_save": null
      },
      "setup_intent": null,
      "shipping_address_collection": null,
      "shipping_cost": null,
      "shipping_options": [],
      "status": "complete",
      "submit_type": "auto",
      "subscription": "sub_1T1tcUJLW3xIuv3LRE1Bkxgh",
      "success_url": "https://stripe.com",
      "tax_id_collection": {
        "enabled": true,
        "required": "never"
      },
      "total_details": {
        "amount_discount": 0,
        "amount_shipping": 0,
        "amount_tax": 0
      },
      "ui_mode": "hosted",
      "url": null,
      "wallet_options": null
    }
  },
  "livemode": false,
  "pending_webhooks": 1,
  "request": {
    "id": null,
    "idempotency_key": null
  },
  "type": "checkout.session.completed"
}