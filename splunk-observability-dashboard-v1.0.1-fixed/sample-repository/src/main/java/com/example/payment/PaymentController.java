package com.example.payment;
import org.springframework.web.bind.annotation.*;
@RestController @RequestMapping("/payments") public class PaymentController { @PostMapping public Payment create(){return null;} @GetMapping("/{id}") public Payment get(@PathVariable String id){return null;} @PostMapping("/{id}/cancel") public Payment cancel(@PathVariable String id){return null;} }
